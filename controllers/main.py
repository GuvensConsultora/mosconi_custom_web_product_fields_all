# -*- coding: utf-8 -*-
"""
Controller: Variant Info & Shipping Calculator API

Por qué existe: El frontend necesita obtener datos de la variante seleccionada
(nombre del color, SKU) y calcular costos de envío sin recargar la página.

Patrón: Controller de Odoo - expone endpoints HTTP para el frontend.
"""
import logging
from odoo import http
from odoo.http import request

_logger = logging.getLogger(__name__)


class VariantInfoController(http.Controller):
    """
    Controlador para obtener información de variantes de producto
    y calcular costos de envío.
    """

    # =========================================================================
    # ENDPOINT: Información de Variante
    # =========================================================================

    @http.route('/shop/variant/info', type='json', auth='public', website=True)
    def get_variant_info(self, product_id, **kwargs):
        """
        Endpoint JSON-RPC que devuelve info de una variante específica.
        """
        if not product_id:
            return {'error': 'product_id es requerido'}

        product = request.env['product.product'].sudo().browse(int(product_id))

        if not product.exists():
            return {'error': 'Producto no encontrado'}

        color_value = self._get_color_attribute_value(product)

        return {
            'color_name': color_value or '',
            'sku': product.default_code or '',
            'product_id': product.id,
        }

    def _get_color_attribute_value(self, product):
        """Extrae el nombre del color de los atributos de la variante."""
        for ptav in product.product_template_attribute_value_ids:
            if ptav.attribute_id.display_type == 'color':
                return ptav.product_attribute_value_id.name
        return None

    # =========================================================================
    # ENDPOINT: Cálculo de Flete por Código Postal
    # =========================================================================

    @http.route('/shop/shipping/calculate', type='json', auth='public', website=True)
    def calculate_shipping(self, zip_code, product_id=None, quantity=1, **kwargs):
        """
        Calcula el costo de envío para un código postal dado.

        IMPORTANTE: Este método NO modifica datos reales del usuario.
        Crea estructuras temporales solo para el cálculo.
        """
        if not zip_code or len(zip_code.strip()) < 4:
            return {
                'success': False,
                'error_message': 'Ingrese un código postal válido (mínimo 4 caracteres)'
            }

        zip_code = zip_code.strip().upper()

        try:
            shipping_options = self._get_shipping_rates(zip_code, product_id, quantity)

            if not shipping_options:
                return {
                    'success': False,
                    'zip_code': zip_code,
                    'error_message': 'No hay métodos de envío disponibles para este código postal'
                }

            return {
                'success': True,
                'zip_code': zip_code,
                'shipping_options': shipping_options
            }

        except Exception as e:
            _logger.error(f'Error calculando shipping para ZIP {zip_code}: {str(e)}')
            return {
                'success': False,
                'zip_code': zip_code,
                'error_message': 'Error al calcular el envío. Intente nuevamente.'
            }

    def _get_shipping_rates(self, zip_code, product_id=None, quantity=1):
        """
        Obtiene las tarifas de envío de todos los carriers disponibles.

        Estrategia: SIEMPRE crear orden temporal para no afectar datos reales.
        La orden se elimina después del cálculo.
        """
        website = request.website
        currency = website.currency_id

        # Buscar carriers publicados
        carriers = request.env['delivery.carrier'].sudo().search([
            ('website_published', '=', True),
            ('company_id', 'in', [False, website.company_id.id])
        ])

        if not carriers:
            return []

        # Crear partner temporal para el cálculo
        temp_partner = self._create_temp_partner(zip_code)

        # Crear orden temporal para el cálculo
        temp_order = self._create_temp_order(temp_partner, product_id, quantity)

        if not temp_order:
            # Sin orden, retornamos precios base
            self._cleanup_temp_partner(temp_partner)
            return self._get_base_carrier_prices(carriers, currency)

        shipping_options = []

        try:
            for carrier in carriers:
                try:
                    # rate_shipment devuelve dict con 'success', 'price', 'error_message', etc.
                    rate = carrier.rate_shipment(temp_order)

                    if rate.get('success'):
                        shipping_options.append({
                            'carrier_id': carrier.id,
                            'carrier_name': carrier.name,
                            'price': rate.get('price', 0),
                            'currency': currency.symbol,
                            'currency_name': currency.name,
                            'delivery_time': rate.get('delivery_time', ''),
                        })
                    else:
                        # Log por qué falló este carrier
                        _logger.debug(
                            f'Carrier {carrier.name} no disponible para ZIP {zip_code}: '
                            f'{rate.get("error_message", "sin mensaje")}'
                        )
                except Exception as e:
                    _logger.debug(f'Error en carrier {carrier.name}: {str(e)}')
                    continue

        finally:
            # SIEMPRE limpiar datos temporales
            self._cleanup_temp_order(temp_order)
            self._cleanup_temp_partner(temp_partner)

        # Ordenar por precio (más barato primero)
        shipping_options.sort(key=lambda x: x['price'])

        return shipping_options

    def _create_temp_partner(self, zip_code):
        """
        Crea un partner temporal SOLO para el cálculo de envío.

        Por qué no reusar: Evita condiciones de carrera si múltiples
        usuarios calculan al mismo tiempo con el mismo ZIP.
        """
        # Obtener país del website o Argentina por defecto
        website = request.website
        country = website.company_id.country_id

        if not country:
            country = request.env['res.country'].sudo().search([
                ('code', '=', 'AR')
            ], limit=1)

        # Crear partner temporal
        # Por qué active=False: No aparece en listados ni búsquedas normales
        temp_partner = request.env['res.partner'].sudo().create({
            'name': f'_temp_shipping_calc_{zip_code}',
            'zip': zip_code,
            'country_id': country.id if country else False,
            'city': 'Ciudad',  # Algunos carriers requieren ciudad
            'street': 'Calle temporal',  # Algunos carriers requieren dirección
            'active': False,
        })

        return temp_partner

    def _create_temp_order(self, partner, product_id=None, quantity=1):
        """
        Crea una orden temporal SOLO para el cálculo de envío.

        Por qué orden nueva y no usar carrito: Evita modificar datos reales
        del usuario y garantiza consistencia en el cálculo.
        """
        website = request.website
        pricelist = website.pricelist_id

        # Si no hay producto específico, intentar usar el carrito actual
        # pero COPIAR sus líneas, no modificarlo
        sale_order = request.website.sale_get_order()

        if not product_id and not sale_order:
            return None

        # Crear orden temporal
        temp_order = request.env['sale.order'].sudo().create({
            'partner_id': partner.id,
            'partner_shipping_id': partner.id,
            'website_id': website.id,
            'pricelist_id': pricelist.id,
            'company_id': website.company_id.id,
            'state': 'draft',
        })

        if product_id:
            # Usar el producto especificado
            product = request.env['product.product'].sudo().browse(int(product_id))
            if product.exists():
                request.env['sale.order.line'].sudo().create({
                    'order_id': temp_order.id,
                    'product_id': product.id,
                    'product_uom_qty': quantity,
                    'price_unit': product.lst_price,
                })
        elif sale_order:
            # Copiar líneas del carrito existente
            for line in sale_order.order_line:
                # Solo copiar productos, no líneas de envío
                if not line.is_delivery:
                    request.env['sale.order.line'].sudo().create({
                        'order_id': temp_order.id,
                        'product_id': line.product_id.id,
                        'product_uom_qty': line.product_uom_qty,
                        'price_unit': line.price_unit,
                    })

        # Verificar que la orden tenga líneas
        if not temp_order.order_line:
            temp_order.sudo().unlink()
            return None

        return temp_order

    def _cleanup_temp_order(self, order):
        """Elimina la orden temporal después del cálculo."""
        if order:
            try:
                # Primero eliminar líneas, luego la orden
                order.order_line.sudo().unlink()
                order.sudo().unlink()
            except Exception as e:
                _logger.warning(f'No se pudo eliminar orden temporal: {str(e)}')

    def _cleanup_temp_partner(self, partner):
        """Elimina el partner temporal después del cálculo."""
        if partner and partner.name.startswith('_temp_shipping_calc_'):
            try:
                partner.sudo().unlink()
            except Exception as e:
                _logger.warning(f'No se pudo eliminar partner temporal: {str(e)}')

    def _get_base_carrier_prices(self, carriers, currency):
        """
        Retorna precios base de los carriers sin cálculo dinámico.
        Fallback cuando no hay productos para calcular.
        """
        options = []

        for carrier in carriers:
            price = getattr(carrier, 'fixed_price', 0) or 0

            options.append({
                'carrier_id': carrier.id,
                'carrier_name': carrier.name,
                'price': price,
                'currency': currency.symbol,
                'currency_name': currency.name,
                'delivery_time': '',
                'is_estimate': True,
            })

        options.sort(key=lambda x: x['price'])
        return options

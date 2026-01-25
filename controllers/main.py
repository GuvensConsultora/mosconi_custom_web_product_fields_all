# -*- coding: utf-8 -*-
"""
Controller: Variant Info & Shipping Calculator API

Por qué existe: El frontend necesita obtener datos de la variante seleccionada
(nombre del color, SKU) y calcular costos de envío sin recargar la página.

Patrón: Controller de Odoo - expone endpoints HTTP para el frontend.
"""
from odoo import http
from odoo.http import request


class VariantInfoController(http.Controller):
    """
    Controlador para obtener información de variantes de producto
    y calcular costos de envío.

    Tip: Los controllers en Odoo se registran automáticamente si están
    en la carpeta 'controllers' y se importan en __init__.py
    """

    # =========================================================================
    # ENDPOINT: Información de Variante
    # =========================================================================

    @http.route('/shop/variant/info', type='json', auth='public', website=True)
    def get_variant_info(self, product_id, **kwargs):
        """
        Endpoint JSON-RPC que devuelve info de una variante específica.

        Args:
            product_id (int): ID del product.product (variante)

        Returns:
            dict: {
                'color_name': str - Nombre del color seleccionado o '',
                'sku': str - Referencia interna/SKU o '',
                'product_id': int - ID de la variante
            }

        Por qué type='json': Permite recibir/enviar datos estructurados.
        El frontend usa rpc() de @web/core/network/rpc para llamar.

        Por qué auth='public': Cualquier visitante puede ver esta info,
        no requiere login. Es información pública del catálogo.

        Por qué website=True: Habilita el contexto de website (idioma,
        pricelist, etc.) que puede afectar los datos mostrados.
        """
        # Validación básica del parámetro
        if not product_id:
            return {'error': 'product_id es requerido'}

        # Por qué sudo(): Los visitantes públicos no tienen acceso directo
        # a product.product. sudo() bypassa las reglas de acceso.
        # Tip: Usar sudo() con cuidado, solo para datos públicos.
        product = request.env['product.product'].sudo().browse(int(product_id))

        if not product.exists():
            return {'error': 'Producto no encontrado'}

        # === OBTENER NOMBRE DEL COLOR ===
        color_value = self._get_color_attribute_value(product)

        return {
            'color_name': color_value or '',
            # Por qué default_code: Es el campo estándar de Odoo para SKU.
            # Algunas empresas lo llaman "referencia interna".
            'sku': product.default_code or '',
            'product_id': product.id,
        }

    def _get_color_attribute_value(self, product):
        """
        Extrae el nombre del color de los atributos de la variante.

        Args:
            product: Recordset product.product

        Returns:
            str: Nombre del color o None si no tiene atributo de color

        Por qué método separado: Single Responsibility Principle.
        Facilita testing y mantenimiento.

        Lógica:
        1. Iteramos los product_template_attribute_value_ids de la variante
        2. Buscamos el que tenga display_type='color' en su atributo
        3. Retornamos el nombre del valor (ej: "Rojo", "Azul")

        Tip: En Odoo, display_type='color' indica que el atributo se muestra
        como círculos de colores en el frontend (color picker).
        """
        for ptav in product.product_template_attribute_value_ids:
            # ptav = product.template.attribute.value
            # ptav.attribute_id = product.attribute (ej: "Color", "Talle")
            # ptav.product_attribute_value_id = product.attribute.value (ej: "Rojo")

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

        Args:
            zip_code (str): Código postal de destino
            product_id (int, optional): ID del producto para calcular peso/volumen
            quantity (int): Cantidad del producto (default 1)

        Returns:
            dict: {
                'success': bool,
                'zip_code': str,
                'shipping_options': [
                    {
                        'carrier_id': int,
                        'carrier_name': str,
                        'price': float,
                        'currency': str,
                        'delivery_time': str (opcional)
                    }
                ],
                'error_message': str (si hay error)
            }

        Por qué endpoint separado del carrito: Permite calcular envío
        ANTES de agregar al carrito, mejorando la experiencia de compra.

        Flujo:
        1. Validar código postal
        2. Buscar carriers disponibles para el website
        3. Crear orden temporal para cálculo
        4. Calcular rate de cada carrier
        5. Retornar opciones con precios
        """
        # Validación del código postal
        if not zip_code or len(zip_code.strip()) < 4:
            return {
                'success': False,
                'error_message': 'Ingrese un código postal válido (mínimo 4 caracteres)'
            }

        zip_code = zip_code.strip().upper()

        try:
            # Obtener carriers disponibles
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
            # Log del error para debugging
            # Por qué no mostrar el error real: Seguridad - no exponer detalles internos
            import logging
            _logger = logging.getLogger(__name__)
            _logger.error(f'Error calculando shipping para ZIP {zip_code}: {str(e)}')

            return {
                'success': False,
                'zip_code': zip_code,
                'error_message': 'Error al calcular el envío. Intente nuevamente.'
            }

    def _get_shipping_rates(self, zip_code, product_id=None, quantity=1):
        """
        Obtiene las tarifas de envío de todos los carriers disponibles.

        Args:
            zip_code: Código postal de destino
            product_id: ID del producto (opcional, para cálculo por peso)
            quantity: Cantidad del producto

        Returns:
            list: Lista de opciones de envío con precios

        Estrategia de cálculo:
        1. Si hay carrito activo, usamos ese para calcular
        2. Si no, creamos una orden temporal con el producto

        Por qué usar sale.order: El método rate_shipment() de delivery.carrier
        requiere un sale.order para calcular el precio (considera peso,
        dirección, reglas, etc.)
        """
        website = request.website
        currency = website.currency_id

        # Obtener carriers publicados en el website
        # Por qué domain específico: Solo carriers activos y publicados
        carriers = request.env['delivery.carrier'].sudo().search([
            ('website_published', '=', True),
            ('company_id', 'in', [False, website.company_id.id])
        ])

        if not carriers:
            return []

        # Crear partner temporal con el ZIP para el cálculo
        # Por qué partner temporal: rate_shipment() usa la dirección del partner
        temp_partner = self._get_or_create_temp_partner(zip_code)

        # Obtener o crear orden para cálculo
        order = self._get_order_for_calculation(temp_partner, product_id, quantity)

        if not order:
            # Sin orden, retornamos precios base de los carriers
            return self._get_base_carrier_prices(carriers, currency)

        shipping_options = []

        for carrier in carriers:
            try:
                # Por qué try/except por carrier: Si uno falla, seguimos con los demás
                rate = carrier.rate_shipment(order)

                if rate.get('success'):
                    shipping_options.append({
                        'carrier_id': carrier.id,
                        'carrier_name': carrier.name,
                        'price': rate.get('price', 0),
                        'currency': currency.symbol,
                        'currency_name': currency.name,
                        # Algunos carriers devuelven tiempo de entrega
                        'delivery_time': rate.get('delivery_time', '')
                    })
            except Exception:
                # Carrier falló, lo saltamos silenciosamente
                continue

        # Ordenar por precio (más barato primero)
        shipping_options.sort(key=lambda x: x['price'])

        return shipping_options

    def _get_or_create_temp_partner(self, zip_code):
        """
        Obtiene el partner del usuario o crea uno temporal para el cálculo.

        Por qué partner temporal: rate_shipment() necesita una dirección
        con ZIP para calcular distancias/zonas.

        El partner temporal se crea con país Argentina por defecto.
        Se podría mejorar detectando el país del website.
        """
        if request.env.user._is_public():
            # Usuario no logueado: buscar o crear partner temporal
            # Por qué 'Cálculo de envío': Identificador para limpiar después
            temp_partner = request.env['res.partner'].sudo().search([
                ('name', '=', 'Cálculo de envío temporal'),
                ('zip', '=', zip_code)
            ], limit=1)

            if not temp_partner:
                # Obtener país Argentina (o el del website)
                country = request.env['res.country'].sudo().search([
                    ('code', '=', 'AR')
                ], limit=1)

                temp_partner = request.env['res.partner'].sudo().create({
                    'name': 'Cálculo de envío temporal',
                    'zip': zip_code,
                    'country_id': country.id if country else False,
                    'active': False,  # No aparece en listados normales
                })

            return temp_partner
        else:
            # Usuario logueado: usar su partner pero actualizar ZIP temporalmente
            partner = request.env.user.partner_id.sudo()
            # Guardamos el ZIP original para restaurarlo después si es necesario
            return partner

    def _get_order_for_calculation(self, partner, product_id=None, quantity=1):
        """
        Obtiene una orden existente o crea una temporal para el cálculo.

        Por qué orden temporal: rate_shipment() necesita:
        - Líneas de orden (para calcular peso/volumen)
        - Partner con dirección (para calcular distancia/zona)
        """
        # Intentar usar el carrito actual si existe
        sale_order = request.website.sale_get_order()

        if sale_order:
            # Actualizar partner de envío temporalmente
            # Por qué write: Modificamos la orden existente para el cálculo
            sale_order.sudo().write({
                'partner_shipping_id': partner.id
            })
            return sale_order

        # No hay carrito, crear orden temporal si tenemos producto
        if not product_id:
            return None

        product = request.env['product.product'].sudo().browse(int(product_id))
        if not product.exists():
            return None

        # Crear orden temporal para el cálculo
        # Por qué state='draft': Orden en borrador, no afecta stock ni contabilidad
        website = request.website
        pricelist = website.pricelist_id

        order = request.env['sale.order'].sudo().create({
            'partner_id': partner.id,
            'partner_shipping_id': partner.id,
            'website_id': website.id,
            'pricelist_id': pricelist.id,
            'company_id': website.company_id.id,
        })

        # Agregar línea con el producto
        request.env['sale.order.line'].sudo().create({
            'order_id': order.id,
            'product_id': product.id,
            'product_uom_qty': quantity,
            'price_unit': product.lst_price,
        })

        return order

    def _get_base_carrier_prices(self, carriers, currency):
        """
        Retorna precios base de los carriers sin cálculo dinámico.

        Fallback cuando no hay orden/producto para calcular.
        Útil para mostrar "desde $X" como referencia.

        Por qué fixed_price: Es el precio fijo configurado en el carrier
        cuando no hay reglas complejas.
        """
        options = []

        for carrier in carriers:
            # Usar precio fijo si está configurado
            price = carrier.fixed_price if hasattr(carrier, 'fixed_price') else 0

            options.append({
                'carrier_id': carrier.id,
                'carrier_name': carrier.name,
                'price': price,
                'currency': currency.symbol,
                'currency_name': currency.name,
                'delivery_time': '',
                'is_estimate': True  # Indica que es precio base, no calculado
            })

        options.sort(key=lambda x: x['price'])
        return options

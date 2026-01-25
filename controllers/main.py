# -*- coding: utf-8 -*-
"""
Controller: Variant Info API

Por qué existe: El frontend necesita obtener datos de la variante seleccionada
(nombre del color, SKU) sin recargar la página. Este endpoint provee esos datos
via JSON-RPC.

Patrón: Controller de Odoo - expone endpoints HTTP para el frontend.
"""
from odoo import http
from odoo.http import request


class VariantInfoController(http.Controller):
    """
    Controlador para obtener información de variantes de producto.

    Tip: Los controllers en Odoo se registran automáticamente si están
    en la carpeta 'controllers' y se importan en __init__.py
    """

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

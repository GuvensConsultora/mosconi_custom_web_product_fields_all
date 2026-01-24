# -*- coding: utf-8 -*-
from odoo import http
from odoo.http import request


class VariantInfoController(http.Controller):

    @http.route('/shop/variant/info', type='json', auth='public', website=True)
    def get_variant_info(self, product_id, **kwargs):
        """
        Devuelve info de la variante: nombre del color y SKU/referencia interna.

        Por qué: El frontend necesita obtener datos de la variante seleccionada
        sin recargar la página completa.
        """
        product = request.env['product.product'].sudo().browse(int(product_id))

        if not product.exists():
            return {'error': 'Producto no encontrado'}

        # Por qué: Buscamos el atributo de tipo 'color' para mostrar su nombre
        color_value = None
        for ptav in product.product_template_attribute_value_ids:
            # Tip: En Odoo, los atributos de color tienen display_type='color'
            if ptav.attribute_id.display_type == 'color':
                color_value = ptav.product_attribute_value_id.name
                break

        return {
            'color_name': color_value or '',
            # Por qué: default_code es el campo estándar de Odoo para SKU/referencia
            'sku': product.default_code or '',
            'product_id': product.id,
        }

/** @odoo-module **/

import publicWidget from "@web/legacy/js/public/public_widget";
import { rpc } from "@web/core/network/rpc";

/**
 * Por qué: Extendemos el widget de variantes de website_sale para capturar
 * cuando el usuario selecciona una variante y mostrar info adicional.
 *
 * Patrón: Widget inheritance de Odoo - extendemos comportamiento existente
 */
publicWidget.registry.VariantInfoDisplay = publicWidget.Widget.extend({
    selector: '#product_detail',

    /**
     * Por qué: Escuchamos el evento estándar de Odoo que se dispara
     * cuando cambia la combinación de variante seleccionada.
     */
    events: {
        'change input.js_variant_change': '_onVariantChange',
        'change select.js_variant_change': '_onVariantChange',
        'click ul.js_add_cart_variants li': '_onVariantClick',
    },

    start() {
        this._super(...arguments);
        // Por qué: Mostramos info inicial si hay variante preseleccionada
        this._updateVariantInfo();
        return Promise.resolve();
    },

    _onVariantChange(ev) {
        // Tip: Pequeño delay para esperar que Odoo actualice el product_id
        setTimeout(() => this._updateVariantInfo(), 100);
    },

    _onVariantClick(ev) {
        setTimeout(() => this._updateVariantInfo(), 100);
    },

    async _updateVariantInfo() {
        const $form = this.$el.find('form.js_add_cart_json, form[action*="/shop/cart/update"]').first();
        if (!$form.length) return;

        // Por qué: product_id se actualiza dinámicamente cuando cambia la variante
        const productId = $form.find('input[name="product_id"]').val();
        if (!productId) return;

        try {
            const result = await rpc('/shop/variant/info', {
                product_id: parseInt(productId),
            });

            this._displayVariantInfo(result);
        } catch (error) {
            console.error('Error obteniendo info de variante:', error);
        }
    },

    _displayVariantInfo(data) {
        const $colorDisplay = this.$el.find('#selected_color_display');
        const $colorName = this.$el.find('#selected_color_name');
        const $skuDisplay = this.$el.find('#variant_sku_display');
        const $sku = this.$el.find('#variant_sku');

        // Mostrar nombre del color
        if (data.color_name) {
            $colorName.text(data.color_name);
            $colorDisplay.removeClass('d-none');
        } else {
            $colorDisplay.addClass('d-none');
        }

        // Mostrar SKU
        if (data.sku) {
            $sku.text(data.sku);
            $skuDisplay.removeClass('d-none');
        } else {
            $skuDisplay.addClass('d-none');
        }
    },
});

export default publicWidget.registry.VariantInfoDisplay;

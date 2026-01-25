/** @odoo-module **/

/**
 * Módulo: Variant Info Display
 *
 * Por qué existe: Odoo muestra los atributos de variante como opciones seleccionables
 * (pills, colores, etc.) pero NO muestra el nombre del valor seleccionado ni el SKU.
 * Este módulo agrega esa información visual para mejorar la UX.
 *
 * Patrón: Widget de Odoo - se adjunta a un selector DOM y escucha eventos.
 */

import publicWidget from "@web/legacy/js/public/public_widget";
import { rpc } from "@web/core/network/rpc";

publicWidget.registry.VariantInfoDisplay = publicWidget.Widget.extend({
    // Por qué #product_detail: Es el contenedor principal de la ficha de producto
    selector: '#product_detail',

    /**
     * Eventos que disparan actualización de info de variante.
     *
     * Por qué múltiples eventos: Odoo usa diferentes controles según el tipo
     * de atributo (radio, select, pills). Debemos cubrir todos los casos.
     */
    events: {
        'change input.js_variant_change': '_onVariantChange',
        'change select.js_variant_change': '_onVariantChange',
        'click ul.js_add_cart_variants li': '_onVariantClick',
    },

    /**
     * Inicialización del widget.
     *
     * Por qué MutationObserver: El product_id se actualiza asincrónicamente
     * por el JS de Odoo. Si solo usamos start(), el valor aún no existe.
     * El observer detecta cuando Odoo escribe el product_id real.
     */
    start() {
        this._super(...arguments);

        // Guardamos referencia al input de product_id para observarlo
        this.$productInput = this.$el.find('input[name="product_id"]');

        if (this.$productInput.length) {
            // Patrón: MutationObserver - detecta cambios en el DOM
            this._setupProductIdObserver();
        }

        // Intento inicial con delay como fallback
        // Por qué 500ms: Tiempo suficiente para que Odoo cargue combination_info
        setTimeout(() => this._updateVariantInfo(), 500);

        return Promise.resolve();
    },

    /**
     * Configura observer para detectar cambios en product_id.
     *
     * Por qué: Odoo actualiza el input hidden "product_id" cuando:
     * 1. Carga la página (después de calcular la variante por defecto)
     * 2. El usuario cambia una opción de variante
     *
     * Tip: MutationObserver es más confiable que polling con setInterval
     */
    _setupProductIdObserver() {
        const input = this.$productInput[0];

        this._observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'attributes' && mutation.attributeName === 'value') {
                    // El product_id cambió, actualizamos la info
                    this._updateVariantInfo();
                }
            }
        });

        // Observamos cambios en el atributo "value" del input
        this._observer.observe(input, {
            attributes: true,
            attributeFilter: ['value']
        });
    },

    /**
     * Cleanup: Desconectamos el observer cuando se destruye el widget.
     *
     * Por qué: Evita memory leaks y callbacks huérfanos.
     * Patrón: Siempre limpiar recursos en destroy()
     */
    destroy() {
        if (this._observer) {
            this._observer.disconnect();
        }
        this._super(...arguments);
    },

    /**
     * Handler para cambios en inputs/selects de variante.
     *
     * Por qué setTimeout: Odoo necesita procesar el cambio antes de que
     * el nuevo product_id esté disponible. 100ms es suficiente.
     */
    _onVariantChange(ev) {
        setTimeout(() => this._updateVariantInfo(), 100);
    },

    _onVariantClick(ev) {
        setTimeout(() => this._updateVariantInfo(), 100);
    },

    /**
     * Obtiene info de la variante actual via RPC y la muestra.
     *
     * Flujo:
     * 1. Busca el form de agregar al carrito
     * 2. Lee el product_id (variante seleccionada)
     * 3. Llama al endpoint /shop/variant/info
     * 4. Muestra los datos en el DOM
     */
    async _updateVariantInfo() {
        // Por qué dos selectores: Odoo 18 puede usar diferentes forms según config
        const $form = this.$el.find('form.js_add_cart_json, form[action*="/shop/cart/update"]').first();
        if (!$form.length) return;

        const productId = $form.find('input[name="product_id"]').val();

        // Validación: product_id debe ser un número válido > 0
        // Por qué: Puede estar vacío o ser 0 mientras Odoo calcula
        if (!productId || productId === '0' || productId === 'false') return;

        try {
            const result = await rpc('/shop/variant/info', {
                product_id: parseInt(productId),
            });

            this._displayVariantInfo(result);
        } catch (error) {
            console.error('Error obteniendo info de variante:', error);
        }
    },

    /**
     * Renderiza la información de variante en el DOM.
     *
     * Estrategia de posicionamiento:
     * - Color: Se muestra inline junto al label del atributo "Color"
     * - SKU: Se muestra debajo del nombre del producto
     *
     * Por qué inline: Mejor UX - el usuario ve inmediatamente qué seleccionó
     * sin buscar en otra parte de la página.
     */
    _displayVariantInfo(data) {
        // === MOSTRAR NOMBRE DEL COLOR ===
        this._displayColorName(data.color_name);

        // === MOSTRAR SKU ===
        this._displaySku(data.sku);
    },

    /**
     * Muestra el nombre del color junto al atributo correspondiente.
     *
     * Por qué buscamos por texto "Color": Es el nombre estándar del atributo.
     * Se podría mejorar buscando por display_type='color' pero requeriría
     * más datos del backend.
     *
     * Tip: :contains() es un selector jQuery que busca por texto interno
     */
    _displayColorName(colorName) {
        // Buscar el label del atributo color en el formulario de variantes
        // Estructura típica: <strong class="attribute_name">Color</strong>
        const $colorLabel = this.$el.find('.js_product strong.attribute_name, .attribute_name')
            .filter(function() {
                return $(this).text().trim().toLowerCase() === 'color';
            });

        if ($colorLabel.length && colorName) {
            // Crear o actualizar el span con el nombre del color
            let $colorValue = $colorLabel.siblings('.selected_color_value');

            if (!$colorValue.length) {
                // Primera vez: crear el elemento
                // Por qué span inline: Se integra visualmente con el label
                $colorValue = $('<span class="selected_color_value text-primary fw-semibold ms-2"></span>');
                $colorLabel.after($colorValue);
            }

            $colorValue.text(`: ${colorName}`);
        } else if ($colorLabel.length) {
            // Sin color: remover el valor mostrado
            $colorLabel.siblings('.selected_color_value').remove();
        }

        // También actualizar el contenedor legacy si existe
        const $colorDisplay = this.$el.find('#selected_color_display');
        const $colorNameEl = this.$el.find('#selected_color_name');

        if (colorName && $colorDisplay.length) {
            $colorNameEl.text(colorName);
            $colorDisplay.removeClass('d-none');
        } else if ($colorDisplay.length) {
            $colorDisplay.addClass('d-none');
        }
    },

    /**
     * Muestra el SKU de la variante.
     *
     * Estrategia: Buscamos un lugar lógico cerca del título del producto.
     * Si existe el contenedor predefinido, lo usamos. Si no, lo creamos
     * después del nombre del producto.
     */
    _displaySku(sku) {
        const $skuDisplay = this.$el.find('#variant_sku_display');
        const $skuEl = this.$el.find('#variant_sku');

        if (sku) {
            if ($skuDisplay.length) {
                // Usar contenedor existente del template
                $skuEl.text(sku);
                $skuDisplay.removeClass('d-none');
            } else {
                // Fallback: crear junto al nombre del producto
                this._createSkuElement(sku);
            }
        } else if ($skuDisplay.length) {
            $skuDisplay.addClass('d-none');
        }
    },

    /**
     * Crea el elemento SKU dinámicamente si no existe en el template.
     *
     * Por qué fallback: Permite que el módulo funcione incluso si
     * el template no incluye el contenedor predefinido.
     */
    _createSkuElement(sku) {
        // Buscar si ya creamos el elemento dinámicamente
        let $dynamicSku = this.$el.find('.dynamic_variant_sku');

        if (!$dynamicSku.length) {
            // Crear después del nombre del producto
            const $productName = this.$el.find('h1[itemprop="name"], .product_name h1').first();

            if ($productName.length) {
                $dynamicSku = $('<div class="dynamic_variant_sku text-muted small mb-2"><span>SKU: </span><span class="sku_value fw-semibold"></span></div>');
                $productName.after($dynamicSku);
            }
        }

        if ($dynamicSku.length) {
            $dynamicSku.find('.sku_value').text(sku);
        }
    },
});

export default publicWidget.registry.VariantInfoDisplay;

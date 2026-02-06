/** @odoo-module **/

/**
 * Módulo: Variant Info Display & Shipping Calculator
 *
 * Por qué existe: Odoo muestra los atributos de variante como opciones seleccionables
 * (pills, colores, etc.) pero NO muestra el nombre del valor seleccionado ni el SKU.
 * Además, no permite calcular flete antes de agregar al carrito.
 *
 * Este módulo agrega:
 * 1. Nombre del color seleccionado (inline con el atributo)
 * 2. SKU de la variante
 * 3. Calculador de flete por código postal
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
        // Eventos del calculador de flete
        'click #btn_calculate_shipping': '_onCalculateShipping',
        'keypress #shipping_zip_code': '_onZipCodeKeypress',
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

        // Inicializar referencias del calculador de flete
        this._initShippingCalculator();

        return Promise.resolve();
    },

    // =========================================================================
    // SECCIÓN: Observador de Variantes
    // =========================================================================

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

    // =========================================================================
    // SECCIÓN: Información de Variante (Color, SKU)
    // =========================================================================

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

        // Guardamos el product_id actual para el cálculo de flete
        this._currentProductId = parseInt(productId);

        try {
            const result = await rpc('/shop/variant/info', {
                product_id: this._currentProductId,
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
     * Muestra el nombre del color inline con el encabezado del atributo.
     *
     * Estrategia mejorada:
     * 1. Busca el label "Color" en todos los posibles contenedores
     * 2. Inserta el valor DENTRO del mismo label (más estético)
     * 3. Usa parent() para encontrar el contenedor correcto
     */
    _displayColorName(colorName) {
        // Por qué múltiples selectores: Odoo puede renderizar de diferentes formas
        // según tipo de atributo (radio, select, pills)
        const $colorLabel = this.$el.find('strong.attribute_name, .attribute_name, label.attribute_name')
            .filter(function() {
                // Por qué regex: Elimina el valor anterior del color antes de comparar
                const text = $(this).text().replace(/\s*-\s*.*/g, '').trim().toLowerCase();
                return text === 'color';
            })
            .first();

        if ($colorLabel.length) {
            // Limpiar cualquier valor anterior del color
            // Por qué remove: Evita duplicados al cambiar variante
            $colorLabel.find('.selected_color_value').remove();

            if (colorName) {
                // Por qué agregar DENTRO del label: Se ve como una sola línea estética
                // Patrón: DOM manipulation - append inserta al final del contenido
                // Por qué \u00A0: Espacio no rompible (mejor que espacio normal)
                const $colorValue = $('<span class="selected_color_value text-primary fw-bold"></span>')
                    .html(`&nbsp;&nbsp;-&nbsp;&nbsp;${colorName}`);

                $colorLabel.append($colorValue);
            }
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

    // =========================================================================
    // SECCIÓN: Calculador de Flete
    // =========================================================================

    /**
     * Inicializa referencias del calculador de flete.
     *
     * Por qué método separado: Organiza el código y facilita mantenimiento.
     * Se llama una vez en start().
     */
    _initShippingCalculator() {
        // Referencias a elementos del DOM
        this.$zipInput = this.$el.find('#shipping_zip_code');
        this.$btnCalculate = this.$el.find('#btn_calculate_shipping');
        this.$btnText = this.$btnCalculate.find('.btn_text');
        this.$btnSpinner = this.$btnCalculate.find('.btn_spinner');
        this.$resultContainer = this.$el.find('#shipping_result');
        this.$resultSuccess = this.$el.find('#shipping_result_success');
        this.$resultError = this.$el.find('#shipping_result_error');
        this.$shippingOptions = this.$el.find('#shipping_options');
        this.$resultZipCode = this.$el.find('#result_zip_code');
        this.$errorMessage = this.$el.find('#shipping_error_message');
    },

    /**
     * Handler para Enter en el campo de código postal.
     *
     * Por qué: Mejora UX - el usuario puede presionar Enter sin
     * tener que hacer click en el botón.
     */
    _onZipCodeKeypress(ev) {
        if (ev.key === 'Enter' || ev.keyCode === 13) {
            ev.preventDefault();
            this._onCalculateShipping();
        }
    },

    /**
     * Handler principal del botón "Calcular flete".
     *
     * Flujo:
     * 1. Validar input
     * 2. Mostrar estado de carga
     * 3. Llamar al API
     * 4. Mostrar resultado
     *
     * Por qué async/await: Código más legible que callbacks anidados.
     */
    async _onCalculateShipping() {
        const zipCode = this.$zipInput.val().trim();

        // Validación básica en frontend
        // Por qué validar en frontend: Feedback inmediato, evita llamadas innecesarias
        if (!zipCode || zipCode.length < 4) {
            this._showShippingError('Ingrese un código postal válido (mínimo 4 caracteres)');
            return;
        }

        // Mostrar estado de carga
        this._setLoadingState(true);

        try {
            // Obtener cantidad del producto
            const quantity = this._getCurrentQuantity();

            const result = await rpc('/shop/shipping/calculate', {
                zip_code: zipCode,
                product_id: this._currentProductId || null,
                quantity: quantity,
            });

            if (result.success) {
                this._showShippingOptions(result);
            } else {
                this._showShippingError(result.error_message);
            }
        } catch (error) {
            console.error('Error calculando flete:', error);
            this._showShippingError('Error de conexión. Intente nuevamente.');
        } finally {
            // Siempre quitar estado de carga
            this._setLoadingState(false);
        }
    },

    /**
     * Obtiene la cantidad seleccionada del producto.
     *
     * Por qué: El costo de envío puede variar según el peso total,
     * que depende de la cantidad.
     */
    _getCurrentQuantity() {
        const $qtyInput = this.$el.find('input[name="add_qty"]');
        return parseInt($qtyInput.val()) || 1;
    },

    /**
     * Alterna el estado de carga del botón.
     *
     * Por qué spinner: Feedback visual de que la operación está en progreso.
     * Por qué deshabilitar: Evita múltiples clicks mientras se procesa.
     */
    _setLoadingState(isLoading) {
        if (isLoading) {
            this.$btnText.addClass('d-none');
            this.$btnSpinner.removeClass('d-none');
            this.$btnCalculate.prop('disabled', true);
        } else {
            this.$btnText.removeClass('d-none');
            this.$btnSpinner.addClass('d-none');
            this.$btnCalculate.prop('disabled', false);
        }
    },

    /**
     * Muestra las opciones de envío disponibles.
     *
     * Formato adaptativo:
     * - 1 opción: "Total: $ 1.500"
     * - Múltiples: "Estándar: $ 1.500" / "Express: $ 2.500"
     */
    _showShippingOptions(result) {
        // Mostrar el código postal consultado
        this.$resultZipCode.text(result.zip_code);

        // Limpiar opciones anteriores
        this.$shippingOptions.empty();

        // Por qué verificar cantidad: Formato diferente para 1 vs múltiples opciones
        const isSingleOption = result.shipping_options.length === 1;

        // Crear HTML para cada opción de envío
        result.shipping_options.forEach((option, index) => {
            const $option = this._createShippingOptionElement(option, index === 0, isSingleOption);
            this.$shippingOptions.append($option);
        });

        // Mostrar resultado exitoso, ocultar error
        this.$resultSuccess.removeClass('d-none');
        this.$resultError.addClass('d-none');
        this.$resultContainer.removeClass('d-none');
    },

    /**
     * Crea el elemento HTML para una opción de envío.
     *
     * Formato simplificado:
     * - Si hay 1 sola opción: "Total: $ 1.500"
     * - Si hay múltiples: "Estándar: $ 1.500" / "Express: $ 2.500"
     *
     * @param {Object} option - Datos de la opción de envío
     * @param {boolean} isFirst - Si es la primera opción (más barata)
     * @param {boolean} isSingleOption - Si es la única opción disponible
     */
    _createShippingOptionElement(option, isFirst, isSingleOption = false) {
        // Formatear precio
        // Por qué toLocaleString: Formato correcto según locale (ej: 1.234,56)
        const formattedPrice = option.price.toLocaleString('es-AR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });

        // Por qué label adaptativo: Si hay una sola opción, mostrar "Total"
        // Si hay múltiples, mostrar nombre simplificado del carrier
        let label;
        if (isSingleOption) {
            label = 'Total';
        } else {
            // Simplificar nombre: "Envío Estándar" → "Estándar"
            label = option.carrier_name.replace(/^Envío\s+/i, '');
        }

        // Construir HTML simplificado
        let html = `
            <div class="shipping-option d-flex justify-content-between align-items-center py-1">
                <div class="text-muted">
                    <span class="fw-semibold">${label}:</span>
                    ${option.delivery_time ? `<small class="ms-1">(${option.delivery_time})</small>` : ''}
                </div>
                <div class="text-end">
                    <span class="fw-bold text-success fs-5">${option.currency} ${formattedPrice}</span>
                </div>
            </div>
        `;

        return $(html);
    },

    /**
     * Muestra un mensaje de error en el calculador de flete.
     *
     * Por qué método separado: Reutilizable para diferentes tipos de error
     * (validación, API, conexión).
     */
    _showShippingError(message) {
        this.$errorMessage.text(message);
        this.$resultError.removeClass('d-none');
        this.$resultSuccess.addClass('d-none');
        this.$resultContainer.removeClass('d-none');
    },
});

export default publicWidget.registry.VariantInfoDisplay;

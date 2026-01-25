# Mosconi - Variante Info y Calculador de Flete

Módulo Odoo 18 que mejora la experiencia de compra en el eCommerce:

1. **Nombre del color**: Muestra el nombre del color seleccionado inline con el atributo
2. **SKU**: Muestra la referencia interna de la variante
3. **Calculador de flete**: Permite calcular el costo de envío por código postal ANTES de agregar al carrito

---

## Índice

- [Problema que resuelve](#problema-que-resuelve)
- [Arquitectura](#arquitectura)
- [Proceso de desarrollo](#proceso-de-desarrollo)
- [Errores encontrados y soluciones](#errores-encontrados-y-soluciones)
- [Cómo funciona](#cómo-funciona)
- [Flujo de datos](#flujo-de-datos)
- [Instalación y configuración](#instalación-y-configuración)
- [Personalización](#personalización)

---

## Problema que resuelve

### Variantes
Odoo muestra los atributos de variante como opciones seleccionables (pills de colores, botones, selects), pero **no muestra el nombre** del valor seleccionado. El usuario ve un círculo rojo pero no ve "Rojo" escrito.

### Flete
El usuario debe agregar productos al carrito e ir al checkout para conocer el costo de envío. Esto causa abandono de carritos cuando el flete es mayor al esperado.

---

## Arquitectura

```
mosconi_custom_web_product_fields_all/
├── __manifest__.py              # Metadatos y dependencias
├── __init__.py
├── controllers/
│   ├── __init__.py
│   └── main.py                  # APIs: /shop/variant/info, /shop/shipping/calculate
├── static/
│   └── src/
│       └── js/
│           └── variant_info.js  # Widget frontend (variantes + flete)
└── views/
    └── templates.xml            # Template inheritance (contenedores HTML)
```

---

## Proceso de desarrollo

Este módulo se desarrolló en varias iteraciones, resolviendo problemas a medida que aparecían.

### Fase 1: Mostrar nombre del color y SKU

#### Objetivo
Cuando el usuario selecciona una variante de color, mostrar el nombre ("Rojo", "Azul") además del círculo de color.

#### Problema inicial
Al instalar el módulo, Odoo arrojó error:

```
ParseError: El elemento "<xpath expr="//table[@id='product_attributes_simple']">"
no se puede localizar en la vista principal
```

#### Causa
En **Odoo 18**, el contenedor de atributos cambió de `<table>` a `<div>`:

```xml
<!-- Odoo 17 y anteriores -->
<table id="product_attributes_simple">

<!-- Odoo 18 -->
<div id="product_attributes_simple">
```

#### Solución
Cambiar el xpath:

```xml
<!-- Antes (incorrecto para Odoo 18) -->
<xpath expr="//table[@id='product_attributes_simple']" position="before">

<!-- Después (correcto) -->
<xpath expr="//div[@id='product_attributes_simple']" position="before">
```

#### Segundo problema: El color no aparecía en la primera selección

El nombre del color solo aparecía después de cambiar la variante dos veces.

#### Causa
El `product_id` se actualiza **asincrónicamente** por el JavaScript de Odoo. Cuando nuestro widget se inicializaba con `start()`, el valor aún no existía.

#### Solución: MutationObserver

```javascript
// Patrón: Observer que detecta cambios en atributos del DOM
_setupProductIdObserver() {
    const input = this.$productInput[0];

    this._observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.attributeName === 'value') {
                // Odoo actualizó el product_id, ahora sí podemos leer
                this._updateVariantInfo();
            }
        }
    });

    this._observer.observe(input, {
        attributes: true,
        attributeFilter: ['value']
    });
}
```

**Por qué MutationObserver y no setTimeout:**
- `setTimeout` con valor fijo puede fallar en conexiones lentas
- MutationObserver reacciona al evento real, no adivina tiempos

---

### Fase 2: Calculador de flete

#### Objetivo
Permitir al usuario ingresar su código postal y ver el costo de envío **antes** de agregar al carrito.

#### Implementación inicial

1. **Template**: Campo de código postal + botón después del "Agregar al carrito"
2. **JavaScript**: Capturar click, llamar API, mostrar resultado
3. **Controller Python**: Endpoint `/shop/shipping/calculate`

#### Problema: El cálculo no funcionaba correctamente

El precio del flete no coincidía con el real, o daba error.

#### Causa (múltiples problemas)

1. **Modificaba el carrito real del usuario**
   ```python
   # MALO: Esto cambia datos reales
   sale_order.sudo().write({
       'partner_shipping_id': partner.id
   })
   ```

2. **El partner temporal no tenía suficientes datos**
   ```python
   # MALO: Algunos carriers necesitan más que solo ZIP
   temp_partner = {
       'name': 'Temporal',
       'zip': zip_code,
   }
   ```

3. **Las órdenes temporales se acumulaban**
   - Cada cálculo creaba una orden que nunca se eliminaba
   - La base de datos se llenaba de órdenes basura

4. **Usuario logueado: no se actualizaba el ZIP**
   ```python
   # MALO: El comentario decía "actualizar ZIP" pero no lo hacía
   partner = request.env.user.partner_id.sudo()
   return partner  # ZIP no actualizado!
   ```

#### Solución: Reescritura completa

**Principio clave: NUNCA modificar datos reales del usuario**

```python
def _get_shipping_rates(self, zip_code, product_id=None, quantity=1):
    # 1. Crear partner temporal (SIEMPRE nuevo)
    temp_partner = self._create_temp_partner(zip_code)

    # 2. Crear orden temporal (COPIAR líneas del carrito, no modificarlo)
    temp_order = self._create_temp_order(temp_partner, product_id, quantity)

    try:
        # 3. Calcular rates
        for carrier in carriers:
            rate = carrier.rate_shipment(temp_order)
            # ...
    finally:
        # 4. SIEMPRE limpiar (incluso si hay error)
        self._cleanup_temp_order(temp_order)
        self._cleanup_temp_partner(temp_partner)
```

**Partner temporal completo:**
```python
def _create_temp_partner(self, zip_code):
    return request.env['res.partner'].sudo().create({
        'name': f'_temp_shipping_calc_{zip_code}',  # Prefijo para identificar
        'zip': zip_code,
        'country_id': country.id,
        'city': 'Ciudad',           # Algunos carriers lo requieren
        'street': 'Calle temporal', # Algunos carriers lo requieren
        'active': False,            # No aparece en búsquedas normales
    })
```

**Copiar carrito en lugar de modificarlo:**
```python
def _create_temp_order(self, partner, product_id=None, quantity=1):
    # Crear orden nueva
    temp_order = request.env['sale.order'].sudo().create({...})

    if sale_order:  # Si hay carrito existente
        # COPIAR líneas, no usar la orden original
        for line in sale_order.order_line:
            if not line.is_delivery:  # Ignorar líneas de envío previas
                request.env['sale.order.line'].sudo().create({
                    'order_id': temp_order.id,
                    'product_id': line.product_id.id,
                    'product_uom_qty': line.product_uom_qty,
                    'price_unit': line.price_unit,
                })

    return temp_order
```

**Limpieza garantizada con `finally`:**
```python
try:
    # Cálculos...
finally:
    # Esto se ejecuta SIEMPRE, incluso si hay excepción
    self._cleanup_temp_order(temp_order)
    self._cleanup_temp_partner(temp_partner)
```

---

## Errores encontrados y soluciones

| Error | Causa | Solución |
|-------|-------|----------|
| xpath no encuentra elemento | Odoo 18 usa `<div>` no `<table>` | Cambiar selector a `//div[@id='...']` |
| Color no aparece primera vez | `product_id` se actualiza async | Usar `MutationObserver` |
| Flete incorrecto | Modificaba carrito real | Crear orden temporal, copiar líneas |
| Partner sin datos suficientes | Faltaban city/street | Agregar campos al partner temporal |
| Órdenes basura en BD | No se eliminaban | Bloque `finally` para cleanup |
| Race condition en partners | Reutilizaba partner por ZIP | Crear partner nuevo cada vez |

---

## Cómo funciona

### 1. Template (templates.xml)

Hereda de `website_sale.product` usando xpath para inyectar HTML:

```xml
<!-- Contenedores para color y SKU (antes de atributos) -->
<xpath expr="//div[@id='product_attributes_simple']" position="before">
    <div id="variant_info_container">
        <div id="selected_color_display" class="d-none">
            <span class="fw-bold">Color: </span>
            <span id="selected_color_name" class="text-primary"></span>
        </div>
        <div id="variant_sku_display" class="d-none mt-1">
            <span class="text-muted">SKU: </span>
            <span id="variant_sku" class="text-muted fw-semibold"></span>
        </div>
    </div>
</xpath>

<!-- Calculador de flete (después de "Agregar al carrito") -->
<xpath expr="//a[@id='add_to_cart']" position="after">
    <div id="shipping_calculator" class="mt-4 p-3 border rounded bg-light">
        <h6 class="fw-bold mb-3">
            <i class="fa fa-truck me-2"/>Calcular costo de envío
        </h6>
        <div class="input-group">
            <input type="text" id="shipping_zip_code"
                   placeholder="Código postal (ej: 1425)" maxlength="8"/>
            <button type="button" id="btn_calculate_shipping" class="btn btn-primary">
                <span class="btn_text">Calcular flete</span>
                <span class="btn_spinner d-none">
                    <span class="spinner-border spinner-border-sm"/>
                    Calculando...
                </span>
            </button>
        </div>
        <div id="shipping_result" class="mt-3 d-none">
            <!-- Resultados se insertan dinámicamente -->
        </div>
    </div>
</xpath>
```

### 2. JavaScript (variant_info.js)

Widget de Odoo que maneja ambas funcionalidades:

```javascript
publicWidget.registry.VariantInfoDisplay = publicWidget.Widget.extend({
    selector: '#product_detail',

    events: {
        // Eventos de variantes
        'change input.js_variant_change': '_onVariantChange',
        'change select.js_variant_change': '_onVariantChange',
        'click ul.js_add_cart_variants li': '_onVariantClick',
        // Eventos de calculador de flete
        'click #btn_calculate_shipping': '_onCalculateShipping',
        'keypress #shipping_zip_code': '_onZipCodeKeypress',
    },

    start() {
        this._super(...arguments);
        this._setupProductIdObserver();  // MutationObserver
        this._initShippingCalculator();  // Referencias DOM
        setTimeout(() => this._updateVariantInfo(), 500);  // Fallback
        return Promise.resolve();
    },
});
```

### 3. Controller Python (main.py)

Dos endpoints JSON-RPC:

```python
# Endpoint 1: Info de variante
@http.route('/shop/variant/info', type='json', auth='public', website=True)
def get_variant_info(self, product_id):
    product = request.env['product.product'].sudo().browse(int(product_id))
    color = self._get_color_attribute_value(product)
    return {
        'color_name': color or '',
        'sku': product.default_code or '',
        'product_id': product.id,
    }

# Endpoint 2: Cálculo de flete
@http.route('/shop/shipping/calculate', type='json', auth='public', website=True)
def calculate_shipping(self, zip_code, product_id=None, quantity=1):
    # Crea temporales, calcula, limpia, retorna opciones
    shipping_options = self._get_shipping_rates(zip_code, product_id, quantity)
    return {
        'success': True,
        'zip_code': zip_code,
        'shipping_options': shipping_options
    }
```

---

## Flujo de datos

### Variantes

```
┌─────────────────┐
│ Página carga    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│ MutationObserver│────▶│ Odoo escribe    │
│ espera cambio   │     │ product_id      │
└─────────────────┘     └────────┬────────┘
                                 │
         ┌───────────────────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ Observer detecta│────▶│ RPC POST        │────▶│ Python busca    │
│ value cambió    │     │ /variant/info   │     │ color y SKU     │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
┌─────────────────┐     ┌─────────────────┐              │
│ DOM actualizado │◀────│ JS renderiza    │◀─────────────┘
│ Color: Rojo     │     │ respuesta       │
│ SKU: PROD-001   │     │                 │
└─────────────────┘     └─────────────────┘
```

### Calculador de flete

```
┌─────────────────┐
│ Usuario ingresa │
│ ZIP: 1425       │
│ Click "Calcular"│
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│ JS valida       │────▶│ Muestra spinner │
│ mínimo 4 chars  │     │ deshabilita btn │
└─────────────────┘     └────────┬────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │ RPC POST        │
                        │ /shipping/      │
                        │ calculate       │
                        └────────┬────────┘
                                 │
         ┌───────────────────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ Python crea     │────▶│ Python crea     │────▶│ Por cada carrier│
│ partner temporal│     │ orden temporal  │     │ rate_shipment() │
│ con ZIP         │     │ con productos   │     │                 │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                        ┌────────────────────────────────┘
                        │
                        ▼
                ┌─────────────────┐
                │ finally:        │
                │ cleanup order   │
                │ cleanup partner │
                └────────┬────────┘
                         │
         ┌───────────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│ JSON response   │────▶│ JS oculta       │
│ {success,       │     │ spinner         │
│  options:[...]} │     │                 │
└─────────────────┘     └────────┬────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │ Renderiza       │
                        │ opciones        │
                        └────────┬────────┘
                                 │
                                 ▼
                ┌─────────────────────────────┐
                │ Envío estándar    $ 1.500   │
                │ ───────────────────────────│
                │ Envío express     $ 2.500   │
                └─────────────────────────────┘
```

---

## Instalación y configuración

### Dependencias

- `website_sale`: Módulo base de eCommerce
- `delivery`: Módulo de métodos de envío (delivery.carrier)

### Instalación

1. Copiar el módulo a la carpeta de addons
2. Actualizar lista de aplicaciones
3. Instalar "Mosconi - Variante Info y Calculador de Flete"

### Configuración de variantes

No requiere configuración. Funciona automáticamente para:
- Productos con atributo de tipo "Color" (display_type='color')
- Variantes que tengan `default_code` (SKU) definido

### Configuración del calculador de flete

Para que funcione, debe haber al menos un método de envío:

1. Ir a **Inventario > Configuración > Métodos de envío**
2. Crear/editar un método de envío
3. Marcar como **Publicado** en el website
4. Configurar precios (fijo, por reglas, o integración con carrier)

---

## Personalización

### Cambiar el país por defecto

El módulo usa el país de la compañía del website. Si no está configurado, usa Argentina:

```python
# En controllers/main.py, método _create_temp_partner
country = website.company_id.country_id
if not country:
    country = request.env['res.country'].sudo().search([
        ('code', '=', 'AR')  # Cambiar por el código deseado
    ], limit=1)
```

### Agregar más información de variante

En `controllers/main.py`, método `get_variant_info`:

```python
return {
    'color_name': color_value or '',
    'sku': product.default_code or '',
    'product_id': product.id,
    # Agregar más campos:
    'weight': product.weight,
    'barcode': product.barcode,
    'volume': product.volume,
}
```

Y en `variant_info.js`, método `_displayVariantInfo`:

```javascript
_displayVariantInfo(data) {
    this._displayColorName(data.color_name);
    this._displaySku(data.sku);
    // Agregar:
    this._displayWeight(data.weight);
}
```

### Cambiar posición del calculador de flete

En `templates.xml`, cambiar el xpath:

```xml
<!-- Después del precio -->
<xpath expr="//div[@itemprop='offers']" position="after">

<!-- Antes de la descripción -->
<xpath expr="//div[@itemprop='description']" position="before">
```

---

## Seguridad

- Endpoints usan `auth='public'` (información pública del catálogo)
- Se usa `sudo()` para acceder a modelos desde usuarios no autenticados
- Solo se exponen datos no sensibles (nombres, precios públicos)
- Partners y órdenes temporales se eliminan después del cálculo
- Partners temporales tienen `active=False` (no aparecen en búsquedas)

---

## Licencia

LGPL-3

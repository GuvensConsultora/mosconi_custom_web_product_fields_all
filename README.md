# Mosconi - Variante Info y Calculador de Flete

Módulo Odoo 18 que mejora la experiencia de compra en el eCommerce:

1. **Nombre del color**: Muestra el nombre del color seleccionado inline con el atributo
2. **SKU**: Muestra la referencia interna de la variante
3. **Calculador de flete**: Permite calcular el costo de envío por código postal ANTES de agregar al carrito

## Problema que resuelve

### Variantes
Odoo muestra los atributos de variante como opciones seleccionables (pills de colores, botones, selects), pero **no muestra el nombre** del valor seleccionado. El usuario ve un círculo rojo pero no ve "Rojo" escrito.

### Flete
El usuario debe agregar productos al carrito e ir al checkout para conocer el costo de envío. Esto causa abandono de carritos cuando el flete es mayor al esperado.

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

## Cómo funciona

### 1. Template (templates.xml)

Hereda de `website_sale.product` para inyectar:

```xml
<!-- Antes de los atributos: contenedores para color y SKU -->
<xpath expr="//div[@id='product_attributes_simple']" position="before">
    <div id="variant_info_container">...</div>
</xpath>

<!-- Después del botón agregar al carrito: calculador de flete -->
<xpath expr="//a[@id='add_to_cart']" position="after">
    <div id="shipping_calculator">
        <input id="shipping_zip_code" placeholder="Código postal"/>
        <button id="btn_calculate_shipping">Calcular flete</button>
        <div id="shipping_result">...</div>
    </div>
</xpath>
```

### 2. JavaScript (variant_info.js)

Widget que maneja dos funcionalidades:

#### Variantes (MutationObserver)
```javascript
// Detecta cuando Odoo actualiza el product_id
this._observer = new MutationObserver((mutations) => {
    this._updateVariantInfo();  // RPC a /shop/variant/info
});
```

#### Calculador de flete
```javascript
events: {
    'click #btn_calculate_shipping': '_onCalculateShipping',
    'keypress #shipping_zip_code': '_onZipCodeKeypress',  // Enter
},

async _onCalculateShipping() {
    const result = await rpc('/shop/shipping/calculate', {
        zip_code: zipCode,
        product_id: this._currentProductId,
        quantity: quantity,
    });
    // Muestra opciones de envío con precios
}
```

### 3. Controller Python (main.py)

#### Endpoint `/shop/variant/info`
```python
@http.route('/shop/variant/info', type='json', auth='public', website=True)
def get_variant_info(self, product_id):
    # Retorna: { color_name, sku, product_id }
```

#### Endpoint `/shop/shipping/calculate`
```python
@http.route('/shop/shipping/calculate', type='json', auth='public', website=True)
def calculate_shipping(self, zip_code, product_id=None, quantity=1):
    # 1. Busca carriers publicados en el website
    # 2. Crea partner temporal con el ZIP
    # 3. Usa carrito existente o crea orden temporal
    # 4. Llama rate_shipment() de cada carrier
    # Retorna: { success, shipping_options: [{ carrier_name, price, ... }] }
```

## Flujo de datos

### Variantes
```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│ Observer    │───▶│ RPC          │───▶│ Python      │
│ detecta     │    │ /variant/    │    │ busca color │
│ product_id  │    │ info         │    │ y SKU       │
└─────────────┘    └──────────────┘    └──────┬──────┘
                                              │
┌─────────────┐    ┌──────────────┐           │
│ Color: Rojo │◀───│ JS renderiza │◀──────────┘
│ SKU: PROD-1 │    │ respuesta    │
└─────────────┘    └──────────────┘
```

### Calculador de flete
```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐    ┌─────────────┐
│ Usuario     │───▶│ JS valida    │───▶│ RPC         │───▶│ Python      │
│ ingresa ZIP │    │ y muestra    │    │ /shipping/  │    │ rate_ship-  │
│ + click     │    │ spinner      │    │ calculate   │    │ ment()      │
└─────────────┘    └──────────────┘    └─────────────┘    └──────┬──────┘
                                                                 │
┌─────────────┐    ┌──────────────┐                              │
│ Envío std:  │◀───│ JS muestra   │◀─────────────────────────────┘
│ $1.500      │    │ opciones     │
│ Express:    │    │ ordenadas    │
│ $2.500      │    │ por precio   │
└─────────────┘    └──────────────┘
```

## Dependencias

- `website_sale`: Módulo base de eCommerce
- `delivery`: Módulo de métodos de envío (delivery.carrier)

## Instalación

1. Copiar el módulo a la carpeta de addons
2. Actualizar lista de aplicaciones
3. Instalar "Mosconi - Variante Info y Calculador de Flete"

## Configuración

### Variantes
No requiere configuración. Funciona automáticamente para:
- Productos con atributo de tipo "Color" (display_type='color')
- Variantes que tengan `default_code` (SKU) definido

### Calculador de flete
Para que funcione, debe haber al menos un método de envío:
1. Ir a **Inventario > Configuración > Métodos de envío**
2. Crear/editar un método de envío
3. Marcar como **Publicado** en el website
4. Configurar precios (fijo, por reglas, o integración con carrier)

## Notas técnicas

### Odoo 18 vs versiones anteriores

En Odoo 18, el contenedor de atributos cambió de `<table>` a `<div>`:

```xml
<!-- Odoo 17 y anteriores -->
<xpath expr="//table[@id='product_attributes_simple']" ...>

<!-- Odoo 18 -->
<xpath expr="//div[@id='product_attributes_simple']" ...>
```

### Cálculo de flete sin carrito

Cuando el usuario no tiene carrito activo:
1. Se crea un partner temporal con el ZIP (active=False)
2. Se crea una orden temporal con el producto
3. Se calcula el rate
4. La orden queda en estado draft (no afecta stock)

### Seguridad

- Endpoints usan `auth='public'` (información pública del catálogo)
- Se usa `sudo()` para acceder a modelos desde usuarios no autenticados
- Solo se exponen datos no sensibles

## Personalización

### Cambiar el país por defecto

En `controllers/main.py`, método `_get_or_create_temp_partner`:

```python
# Cambiar 'AR' por el código del país deseado
country = request.env['res.country'].sudo().search([
    ('code', '=', 'AR')
], limit=1)
```

### Agregar más información de variante

En el mismo archivo, método `get_variant_info`, agregar campos al return:

```python
return {
    'color_name': color_value or '',
    'sku': product.default_code or '',
    'product_id': product.id,
    # Agregar más campos:
    'weight': product.weight,
    'barcode': product.barcode,
}
```

## Licencia

LGPL-3

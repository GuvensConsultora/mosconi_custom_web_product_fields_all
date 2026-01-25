# Mosconi - Mostrar Color y SKU de Variante

Módulo Odoo 18 que muestra el nombre del color seleccionado y el SKU/referencia interna en la ficha de producto del eCommerce.

## Problema que resuelve

Odoo muestra los atributos de variante como opciones seleccionables (pills de colores, botones, selects), pero **no muestra el nombre** del valor seleccionado. El usuario ve un círculo rojo pero no ve "Rojo" escrito.

Este módulo agrega:
- **Nombre del color**: Se muestra inline junto al label "Color" (ej: `Color: Rojo`)
- **SKU**: Se muestra debajo del nombre del producto

## Arquitectura

```
mosconi_custom_web_product_fields_all/
├── __manifest__.py          # Metadatos del módulo
├── __init__.py              # Imports Python
├── controllers/
│   ├── __init__.py
│   └── main.py              # Endpoint API /shop/variant/info
├── static/
│   └── src/
│       └── js/
│           └── variant_info.js  # Widget frontend
└── views/
    └── templates.xml        # Template inheritance
```

## Cómo funciona

### 1. Template (templates.xml)

Hereda de `website_sale.product` usando xpath para inyectar contenedores HTML donde se mostrará la información:

```xml
<template id="product_variant_info" inherit_id="website_sale.product">
    <xpath expr="//div[@id='product_attributes_simple']" position="before">
        <div id="variant_info_container">
            <!-- Contenedores para color y SKU -->
        </div>
    </xpath>
</template>
```

### 2. JavaScript (variant_info.js)

Widget que se adjunta a `#product_detail` y:

1. **Detecta cambios de variante** mediante:
   - Eventos `change` en inputs/selects
   - `MutationObserver` en el input hidden `product_id`

2. **Llama al API** `/shop/variant/info` via JSON-RPC

3. **Renderiza la información**:
   - Color: Busca el label "Color" y agrega el nombre como sibling
   - SKU: Usa el contenedor predefinido o lo crea dinámicamente

**Patrón clave: MutationObserver**

```javascript
this._observer = new MutationObserver((mutations) => {
    // Detecta cuando Odoo actualiza el product_id
    this._updateVariantInfo();
});
this._observer.observe(input, { attributes: true, attributeFilter: ['value'] });
```

Esto resuelve el problema de timing: el `product_id` no está disponible inmediatamente al cargar la página.

### 3. Controller Python (main.py)

Endpoint JSON-RPC que recibe el `product_id` (variante) y retorna:

```python
{
    'color_name': 'Rojo',      # Nombre del atributo tipo color
    'sku': 'PROD-001-RED',     # Campo default_code
    'product_id': 123
}
```

**Lógica para obtener el color:**

```python
for ptav in product.product_template_attribute_value_ids:
    if ptav.attribute_id.display_type == 'color':
        return ptav.product_attribute_value_id.name
```

## Flujo de datos

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Usuario click  │────▶│  JS detecta      │────▶│  RPC call       │
│  en variante    │     │  cambio          │     │  /shop/variant/ │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
┌─────────────────┐     ┌──────────────────┐              ▼
│  DOM actualizado│◀────│  JS renderiza    │◀────┌─────────────────┐
│  Color: Rojo    │     │  respuesta       │     │  Python busca   │
│  SKU: PROD-001  │     └──────────────────┘     │  en BD          │
└─────────────────┘                              └─────────────────┘
```

## Dependencias

- `website_sale`: Módulo base de eCommerce de Odoo

## Instalación

1. Copiar el módulo a la carpeta de addons
2. Actualizar lista de aplicaciones
3. Instalar "Mosconi - Mostrar Color y SKU de Variante"

## Configuración

No requiere configuración adicional. Funciona automáticamente para:
- Productos con atributo de tipo "Color" (display_type='color')
- Variantes que tengan `default_code` (SKU) definido

## Notas técnicas

### Odoo 18 vs versiones anteriores

En Odoo 18, el contenedor de atributos cambió de `<table>` a `<div>`:

```xml
<!-- Odoo 17 y anteriores -->
<xpath expr="//table[@id='product_attributes_simple']" ...>

<!-- Odoo 18 -->
<xpath expr="//div[@id='product_attributes_simple']" ...>
```

### Seguridad

- El endpoint usa `auth='public'` porque muestra información pública del catálogo
- Se usa `sudo()` para acceder a `product.product` desde visitantes no autenticados
- Solo se exponen datos no sensibles (nombre de color, SKU)

## Licencia

LGPL-3

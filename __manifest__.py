{
    "name": "Mosconi - Mostrar Color y SKU de Variante",
    "version": "18.0.1.0.0",
    "category": "Website",
    "summary": "Muestra el nombre del color y la referencia al seleccionar una variante en la tienda",
    "depends": ["website_sale"],
    "data": [
        "views/templates.xml",
    ],
    "assets": {
        "web.assets_frontend": [
            "mosconi_custom_web_product_fields_all/static/src/js/variant_info.js",
        ],
    },
    "installable": True,
    "license": "LGPL-3",
}

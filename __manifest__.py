{
    "name": "Mosconi - Variante Info y Calculador de Flete",
    "version": "18.0.2.0.0",
    "category": "Website",
    "summary": "Muestra color/SKU de variante y calcula flete por código postal",
    "description": """
        Módulo para mejorar la experiencia de compra en el eCommerce:

        * Muestra el nombre del color seleccionado (inline con el atributo)
        * Muestra el SKU/referencia interna de la variante
        * Calculador de flete por código postal antes de agregar al carrito

        Requiere tener métodos de envío configurados y publicados en el website.
    """,
    "author": "Guvens Consultora",
    "depends": [
        "website_sale",
        "delivery",  # Por qué: Necesario para acceder a delivery.carrier
    ],
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

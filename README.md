# GOVP for Shopify

Aplicación no embebida y autoasistida para generar GOVP cuando Shopify marca
un pedido como completado.

## Propiedades

- instalación OAuth desde Shopify;
- creación automática de la conexión con GOVP Exchange;
- suscripciones declarativas, HMAC obligatorio y deduplicación por webhook ID;
- emisión idempotente por pedido;
- reintentos y reconciliación cada cinco minutos;
- minimización: no solicita nombre, correo, dirección ni teléfono del cliente;
- webhooks obligatorios de acceso y borrado;
- eliminación de datos con `shop/redact`;
- token de Exchange cifrado con AES-GCM.

## Preparación por Gemacode

1. Crear la app en Shopify y enlazar `shopify.app.toml` con Shopify CLI.
2. Crear D1, sustituir su ID en `wrangler.jsonc` y aplicar migraciones.
3. Configurar `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` y una clave aleatoria de
   32 bytes codificada en base64 como secretos del Worker.
4. Ajustar `APP_URL` y las URLs de callback si cambia el dominio.
5. Ejecutar `shopify app deploy` para publicar scopes y webhooks.
6. Desplegar el Worker y probar instalación, webhook duplicado, reintento,
   desinstalación y los tres webhooks de privacidad.

El comerciante solo pulsa **Instalar**. La conexión con Exchange se crea durante
OAuth; no necesita pegar tokens ni escribir código.

## Desarrollo y pruebas nativas

```bash
npm ci
npm run check
```

`npm test` ejecuta el código en el runtime oficial de Cloudflare Workers, aplica
las migraciones D1 a una base aislada y prueba HTTP y límites HMAC. `npm run build`
realiza el empaquetado de despliegue de Wrangler sin publicar. El CI comprueba de
forma determinista `shopify.app.toml`, sus ámbitos y todas sus suscripciones.

Para una prueba con una tienda de desarrollo, copie `shopify.app.toml`, ejecute
`shopify app config link`, cree un D1 de pruebas y configure secretos desde
`.dev.vars.example`. Nunca use una tienda de producción para desarrollo activo.
El `client_id` compuesto por ceros es deliberadamente inerte y será sustituido por
Shopify CLI al enlazar la app de desarrollo.

Después de enlazar esa app e iniciar sesión, ejecute `npm run validate:shopify`.
Ésta es la puerta nativa oficial de Shopify y no se ejecuta en pull requests porque
el CLI exige una sesión interactiva de una cuenta Shopify.

Licencia Apache-2.0. Consulte `CONTRIBUTING.md` y `SECURITY.md`.

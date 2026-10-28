# Euríbor Hipoteca

Aplicación React con Vite para consultar el histórico del Euríbor a 12 meses y preparar el seguimiento de hipotecas personales. La autenticación y la persistencia se basan en Firebase Authentication y Cloud Firestore.

## Desarrollo local

1. Instala Node.js 20 o posterior.
2. Ejecuta `npm ci`.
3. Copia `.env.example` a `.env` y rellena la configuración de la aplicación web de Firebase.
4. En Firebase, activa el acceso por email/contraseña y crea Firestore.
5. Ejecuta `npm run dev`.

Sin credenciales Firebase la aplicación muestra las instrucciones de configuración en vez de intentar conectarse.

## Histórico del Euríbor

El script consulta la serie mensual de Euríbor a 12 meses del Bundesbank desde `2019-01-01` hasta la fecha actual y guarda cada observación en `euribor_history/{YYYY-MM-DD}`. Los documentos incluyen `date`, `value`, `source` y `updatedAt`. Las ejecuciones repetidas actualizan esos documentos sin duplicarlos.

Para ejecutarlo en local, configura `GOOGLE_APPLICATION_CREDENTIALS` con la ruta a una cuenta de servicio de Firebase/Google Cloud y `FIREBASE_PROJECT_ID` con el ID del proyecto. Como alternativa, `FIREBASE_SERVICE_ACCOUNT` admite el JSON de la cuenta de servicio (es lo que usa el workflow). No guardes la cuenta de servicio en Git. Instala las dependencias con `npm ci`.

Por defecto descarga todo el histórico desde `EURIBOR_START_PERIOD`. Con `EURIBOR_LOOKBACK_DAYS=7` solo pide los últimos 7 días, que basta para una actualización diaria:

```sh
npm run sync:euribor
EURIBOR_LOOKBACK_DAYS=7 npm run sync:euribor
```

### Actualización automática

El workflow `.github/workflows/sync-euribor.yml` no está programado: se lanza a mano desde la pestaña Actions (*Run workflow*), o desde fuera con la API de GitHub o `gh workflow run sync-euribor.yml`. Por defecto sincroniza los últimos 7 días, y se puede indicar otro número de días; un valor grande como `3000` recarga todo el histórico. Necesita el secret `FIREBASE_SERVICE_ACCOUNT` con el JSON completo de la cuenta de servicio. Las medias mensuales se calculan en la aplicación a partir de los datos diarios, así que no se guarda nada más.

La cuenta de servicio debe tener permisos de escritura en Firestore. El acceso público de lectura al histórico y el acceso individual a `/users/{uid}` y `/users/{uid}/mortgages/{mortgageId}` están definidos en `firestore.rules`.

## Hipotecas y simulaciones

Al iniciar sesión, cada persona puede crear, editar y eliminar sus hipotecas bajo `users/{uid}/mortgages/{mortgageId}`.

Cada hipoteca se guarda como una **foto de partida** a una fecha (`snapshotDate`): capital pendiente, cuota actual, fecha final, diferencial, frecuencia de revisión, próxima revisión y desfase del Euríbor (por defecto 3 meses antes: la revisión de septiembre usa la media de junio). Opcionalmente, capital inicial, fecha de inicio y amortizaciones anticipadas realizadas (fecha, importe y si redujeron cuota o plazo).

Desde la foto, la aplicación proyecta mes a mes con el sistema francés:

- Las revisiones pasadas usan el **Euríbor medio mensual real**, calculado a partir de los datos diarios sincronizados, y recalculan la cuota.
- Las amortizaciones posteriores a la foto se aplican con su efecto (cuota o plazo). Con ello se obtienen el capital, la cuota y el fin estimados de hoy, sin volver a introducir datos.
- Hacia delante, las revisiones sin dato real usan el Euríbor supuesto del simulador (slider y variación por revisión), con opción de simular una amortización anticipada puntual o mensual.

Cuando quieras reajustar con las cifras exactas del banco, edita la hipoteca y actualiza la foto. No incluye comisiones, seguros, suelo ni techo de tipo.

## App instalable (PWA) y versiones

La aplicación se puede instalar como app (Chrome y Edge: "Instalar"; iPhone: Safari > "Añadir a pantalla de inicio"). `public/manifest.json` define nombre, iconos y colores, y `public/sw.js` es el service worker, que solo se registra en producción.

- **Versión:** sale de `version` en `package.json` y se muestra junto al logo (`v0.2.0`). Se sube en cada modificación (`npm version patch --no-git-tag-version`, o `minor` si hay una funcionalidad nueva).
- **Caché:** el build escribe esa versión en el nombre de la caché del service worker (`euribor-hipoteca-v0.2.0`). Al subirla, el navegador instala el nuevo service worker, que se activa de inmediato y borra las cachés de versiones anteriores. Las peticiones usan red primero y la caché solo como respaldo sin conexión, y Firebase nunca se cachea. Si no subes la versión, el service worker no cambia y no se renueva la caché.
- **Iconos:** `public/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` y `apple-touch-icon.png`.

## Comprobaciones

```sh
npm test
npm run build
```

## GitHub Pages

El workflow `.github/workflows/deploy.yml` publica la aplicación al hacer push a `main`. Configura como secrets del repositorio las seis variables `VITE_FIREBASE_*` de `.env.example` y habilita GitHub Pages con GitHub Actions.

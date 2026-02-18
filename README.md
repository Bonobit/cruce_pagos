# 📊 Conciliación Gestor vs TNS

App web para cruzar/conciliar registros de dos fuentes (Gestor y TNS) por módulo (Pagos y Letras).

---

## 🚀 Instalación y ejecución

```bash
# 1. Instalar dependencias
npm install

# 2. Correr en modo desarrollo (con hot-reload)
npm run dev

# 3. Abrir en el navegador
http://localhost:3000
```

Para producción:
```bash
npm run build
npm start
```

---

## 📁 Estructura del proyecto

```
reconciliation-app/
├── src/
│   ├── server.ts               # Entry point Express
│   ├── types.ts                # Interfaces y aliases de columnas
│   ├── routes/
│   │   └── api.ts              # Endpoints REST
│   └── services/
│       ├── fileParser.ts       # Leer Excel/CSV con auto-detección de header
│       ├── reconciliation.ts   # Lógica de cruce
│       └── excelExport.ts      # Generación del Excel resultado
├── public/
│   └── index.html              # UI completa (HTML + CSS + JS vanilla)
├── data/                       # Archivos de ejemplo para pruebas
│   ├── sample_gestor_pagos.xlsx
│   ├── sample_tns_pagos.xlsx
│   ├── sample_gestor_letras.xlsx
│   └── sample_tns_letras.xlsx
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🔌 API Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/upload/gestor?modulo=pagos\|letras` | Subir archivo GESTOR |
| `POST` | `/api/upload/tns?modulo=pagos\|letras` | Subir archivo TNS |
| `GET`  | `/api/status?modulo=pagos\|letras` | Estado de archivos cargados |
| `GET`  | `/api/cruce?modulo=pagos\|letras` | Obtener cruce en JSON |
| `GET`  | `/api/cruce/excel?modulo=pagos\|letras` | Descargar Excel resultado |
| `DELETE` | `/api/reset?modulo=pagos\|letras` | Limpiar módulo |

---

## 📋 Reglas de conciliación

### Clave de cruce ("Registro")
- Normalización: `TRIM + UPPERCASE + sin tildes`
- Auto-detección por alias de columna (ver `src/types.ts`)

### Columnas buscadas por módulo

**Pagos — GESTOR:**
- Registro: `RECIBO`, `REGISTRO`, `N°`, `NUMERO`…
- Fecha Vto: `FECHA`, `FECHA DE PAGO`, `FECHA VENCIMIENTO`…

**Letras — GESTOR:**
- Registro: `NÚMERO`, `NUMERO`, `N°`, `REGISTRO`…
- Fecha Vto: `FECHA VENCIMIENTO`, `FECHA VTO`…

**TNS (ambos módulos):** mismas búsquedas en el archivo TNS.

> Si no se encuentra la columna esperada, se usa la **primera columna** del archivo y se genera un aviso visible en la UI.

### Duplicados
- Si un mismo Registro aparece **más de una vez** en el mismo archivo → se consolida tomando la ocurrencia con la **fecha de vencimiento más próxima** (fecha más temprana).

### Tipo y Fecha Vto
- Se **prefiere siempre la data del GESTOR**.
- Si el Registro solo existe en TNS y TNS no trae tipo/fecha → queda vacío.
- Tipo por defecto: `RECIBO` (módulo pagos) o `LETRA` (módulo letras).

### Estado de conciliación
| Estado | Significado |
|--------|-------------|
| `Ambos` | Existe en Gestor **y** en TNS ✅ |
| `Solo Gestor` | Solo existe en Gestor 🟡 |
| `Solo TNS` | Solo existe en TNS 🟠 |

---

## 🎨 Columnas del Excel generado

| Columna | Descripción |
|---------|-------------|
| Registro | Clave normalizada |
| Tipo | RECIBO / LETRA |
| Fecha Vto | Fecha de vencimiento |
| Gestor | `X` si existe en Gestor |
| TNS | `X` si existe en TNS |
| Estado Conciliación | Ambos / Solo Gestor / Solo TNS |

El Excel incluye:
- Colores por estado (verde = conciliado, amarillo = solo gestor, naranja = solo TNS)
- Auto-filter activado
- Primera fila congelada
- Tabla de resumen al final

---

## 🛠️ Agregar columnas conocidas

Edita `src/types.ts` → `COLUMN_ALIASES` para agregar alias de columna propios:

```typescript
export const COLUMN_ALIASES = {
  pagos: {
    registro: ['RECIBO', 'MI_NUEVA_COLUMNA', ...],
    fechaVto: ['FECHA', 'OTRA_FECHA', ...],
  },
  ...
};
```

---

## 📦 Dependencias principales

| Paquete | Uso |
|---------|-----|
| `express` | Servidor HTTP |
| `multer` | Upload de archivos en memoria |
| `xlsx` (SheetJS) | Lectura de `.xlsx`, `.xls`, `.csv` |
| `exceljs` | Generación del Excel resultado con formato |
| `ts-node-dev` | Hot-reload en desarrollo |

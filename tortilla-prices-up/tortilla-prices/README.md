# PPKTM · Predictor del Precio de un Kilo de Tortilla

Misma arquitectura que el repo `students`: frontend estático + Supabase (tabla CRUD) + API FastAPI con modelo en `model.pkl`.

```
index.html  app.js  config.js  styles.css     Frontend estático (diseño PPKTM, Tailwind por CDN)
supabase/
  schema.sql                                   Tabla tortilla_prices
  prepare_csv.py                               Genera el CSV listo para importar
ml-api/
  train.py                                     CSV -> pronósticos y agregados -> model/model.pkl
  test_model.py                                Prueba rápida del pickle
  app/main.py, app/forecasting.py              Holt + pipeline de validación/backtest
  app/bilstm.py                                Bi-LSTM (PyTorch)
  requirements-train.txt                       torch (solo para entrenar)
  app/routes/forecast.py                       GET /summary, /forecast, /channels
  data/tortilla_prices.csv   model/model.pkl   requirements.txt
```

## Vistas
- **Tablero Ejecutivo**: KPIs, pronóstico a 3/6/12 meses con IC95, ranking de 32 estados (filtros de estado, canal y horizonte).
- **Canales & Brechas**: Mom & Pop vs Big Retail, evolución y desglose por estado.
- **Registros**: tabla paginada (100 por página) con edición en celda, agregar, editar y eliminar, vía Supabase.

## Puesta en marcha
1. **API**
   ```bash
   cd ml-api
   python -m venv .venv && source .venv/bin/activate   # opcional
   pip install -r requirements.txt
   uvicorn app.main:app --reload     # sirve el model.pkl incluido (Holt, ver Modelo)
   ```
2. **Frontend**: sirve la carpeta raíz (`python -m http.server 5500`) y abre http://localhost:5500.
   `config.js` apunta a la API en `http://127.0.0.1:8000`.
3. **Supabase** (solo para la vista Registros): crea un proyecto, ejecuta `supabase/schema.sql`,
   corre `python supabase/prepare_csv.py` e importa `supabase/tortilla_prices_supabase.csv`.
   Después pon tu URL y clave anónima en `config.js`.

## Modelo: pasar a Bi-LSTM
El `model/model.pkl` incluido fue generado con **Holt** (el Bi-LSTM no pudo entrenarse en el entorno donde se armó el proyecto). Para generar el Bi-LSTM:
```bash
cd ml-api
pip install -r requirements-train.txt
python train.py                 # Bi-LSTM por defecto (equivale a --model bilstm)
python train.py --epochs 100    # más rápido, útil para una primera prueba
python train.py --model holt    # vuelve al modelo clásico
```
`torch` solo se necesita para entrenar: el pickle guarda tipos nativos de Python, así que la API y el frontend no cambian.
Se entrenan 3 redes por serie (validación 2025, error por horizonte y pronóstico final) en 33 series × 3 canales; tarda más que Holt.

Arquitectura (`app/bilstm.py`): ventana de 24 meses → Bi-LSTM (32 unidades por dirección) → capa densa → 12 salidas directas (diferencias respecto al último valor); Adam, recorte de gradiente y parada temprana. Series con menos de 80 meses usan Holt.

## Notas
- Los pronósticos y agregados salen del CSV al entrenar; **editar registros en Supabase no cambia el tablero** hasta volver a correr `train.py`.
- Validación: ajuste hasta dic-2024 contra 2025; IC95 = ±1.96·RMSE del error fuera de muestra por horizonte (aproximación empírica).
- "Nacional" = promedio simple de las 32 entidades. Se excluyen filas sin precio o con precio 0 (≈2.1 %).
- El CSV original trae espacios no separables en nombres como "Baja California"; `train.py` y `prepare_csv.py` los normalizan.

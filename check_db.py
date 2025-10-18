import sqlite3
import os

# Conectar a la base de datos
db_path = os.path.join(os.path.dirname(__file__), 'src', 'backend', 'spm.db')
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Verificar si existe la tabla materiales
cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='materiales';")
table_exists = cursor.fetchone()

if table_exists:
    print("La tabla 'materiales' existe.")
    # Contar registros
    cursor.execute("SELECT COUNT(*) FROM materiales;")
    count = cursor.fetchone()[0]
    print(f"Registros en la tabla: {count}")

    if count > 0:
        # Mostrar algunos registros
        cursor.execute("SELECT codigo, descripcion FROM materiales LIMIT 5;")
        rows = cursor.fetchall()
        print("Primeros 5 registros:")
        for row in rows:
            print(f"  {row[0]}: {row[1]}")
else:
    print("La tabla 'materiales' NO existe.")

conn.close()
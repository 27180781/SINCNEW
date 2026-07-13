# מערכת ארבעת היסודות — Node עם תלויות ייצור: pg (PostgreSQL) + fflate (קריאת Excel)
FROM node:22-alpine

WORKDIR /app

# התקנת תלויות ייצור בלבד (pg, fflate). devDependencies כמו pg-mem לא מותקנות.
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

# CapRover ממפה כברירת מחדל לפורט 80 בתוך הקונטיינר
ENV PORT=80
# נתיב קובץ הנתונים — רלוונטי רק במצב JSON (ללא DATABASE_URL).
# בפרודקשן מומלץ להגדיר DATABASE_URL לחיבור PostgreSQL.
ENV DATA_FILE=/app/data/db.json

EXPOSE 80

CMD ["node", "server.js"]

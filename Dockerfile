# מערכת ארבעת היסודות — אין תלויות חיצוניות, רק Node
FROM node:22-alpine

WORKDIR /app
COPY . .

# CapRover ממפה כברירת מחדל לפורט 80 בתוך הקונטיינר
ENV PORT=80
# נתיב קובץ הנתונים — מומלץ למפות /app/data ל-Persistent Directory ב-CapRover
ENV DATA_FILE=/app/data/db.json

EXPOSE 80

CMD ["node", "server.js"]

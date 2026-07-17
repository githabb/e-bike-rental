FROM node:20-bookworm

# Встановлюємо необхідні системні залежності для збірки C++ модулів
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package*.json ./

# Примусово змушуємо sqlite3 компілюватися з вихідників (build-from-source)
RUN npm install --build-from-source sqlite3

# Встановлюємо решту залежностей
RUN npm install

COPY . .

EXPOSE 10000

CMD ["node", "server.js"]

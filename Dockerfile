#########################################################
# BACKEND
#########################################################

FROM node:22-slim AS build

#RUN groupadd -r nodejs -g 433 && \
#    useradd -u 431 -r -g nodejs -s /sbin/nologin -c "Docker image user" nodejs
# Créer un répertoire pour l'application et on change la propriété de ce répertoire à notre nouvel utilisateur
#RUN mkdir /home/nodejs && \
#    chown -R nodejs:nodejs /home/nodejs
# Changer l'utilisateur courant à notre nouvel utilisateur
#USER nodejs

WORKDIR /app/back
COPY . .
RUN npm install

# Expose port for API
EXPOSE $BACKEND_PORT

# Start REST API when the container runs
CMD ["npm", "start"]

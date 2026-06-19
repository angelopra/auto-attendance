FROM node:22-alpine AS build
WORKDIR /usr/src/app

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY . .
ARG BUILD_TARGET=production
RUN echo "Building Angular app with configuration: $BUILD_TARGET" \
	&& npx ng build --configuration=${BUILD_TARGET}

FROM nginx:alpine AS runner
RUN rm -rf /usr/share/nginx/html/*
COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=build /usr/src/app/dist/kendo-attendance /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

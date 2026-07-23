FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS base
WORKDIR /app
EXPOSE 8080

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY ["MarketSentinel.Api/MarketSentinel.Api.csproj", "MarketSentinel.Api/"]
RUN dotnet restore "MarketSentinel.Api/MarketSentinel.Api.csproj"
COPY . .
WORKDIR "/src/MarketSentinel.Api"
RUN dotnet build "MarketSentinel.Api.csproj" -c Release -o /app/build

FROM build AS publish
RUN dotnet publish "MarketSentinel.Api.csproj" -c Release -o /app/publish

FROM base AS final
WORKDIR /app
RUN apt-get update -qq && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY --from=publish /app/publish .
ENTRYPOINT ["dotnet", "MarketSentinel.Api.dll"]

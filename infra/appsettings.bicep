targetScope = 'resourceGroup'

param staticWebAppName string

@minLength(1)
param entraClientId string

@secure()
@minLength(1)
param entraClientSecret string

@secure()
@minLength(2)
param approvedUsersJson string

@secure()
@minLength(1)
param storageConnectionString string

resource site 'Microsoft.Web/staticSites@2024-11-01' existing = {
  name: staticWebAppName
}

// Authoritative settings set: do not deploy partial/blank auth configuration.
// Add any future app settings here before using this module; PUT replaces the set.
resource appSettings 'Microsoft.Web/staticSites/config@2024-11-01' = {
  parent: site
  name: 'appsettings'
  properties: {
    STORAGE_CONNECTION_STRING: storageConnectionString
    APPROVED_USERS_JSON: approvedUsersJson
    ENTRA_CLIENT_ID: entraClientId
    ENTRA_CLIENT_SECRET: entraClientSecret
  }
}

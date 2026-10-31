targetScope = 'resourceGroup'

@description('Globally unique Static Web App name. This deploys into an EXISTING resource group.')
@minLength(2)
param staticWebAppName string

@description('Globally unique, lowercase alphanumeric Storage account name (3-24 characters).')
@minLength(3)
@maxLength(24)
param storageAccountName string

@description('Supported SWA region; may differ from the Storage region.')
param location string

param storageLocation string = location

@description('External tenant app registration client ID, NOT the GitHub Azure login client ID.')
@minLength(1)
param entraClientId string

@secure()
@minLength(1)
param entraClientSecret string

@description('JSON array of explicitly approved stable SWA userIds. Use an unmatchable bootstrap placeholder until identities are verified.')
@secure()
@minLength(2)
param approvedUsersJson string

@description('Optional explicit connection string for this Storage account. Empty derives an account key server-side, passed only to a secure module parameter.')
@secure()
param storageConnectionString string = ''

@minValue(1)
@maxValue(365)
param softDeleteDays int = 14

@description('Adopt existing owned site/account/services without root PUTs. Requires verified security and retention baseline.')
param adoptExisting bool = false

// Provisioning shares the read-only resource template; adoption retains parents.
module resources './resources.bicep' = if (!adoptExisting) {
  params: {
    staticWebAppName: staticWebAppName
    storageAccountName: storageAccountName
    location: location
    storageLocation: storageLocation
    softDeleteDays: softDeleteDays
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2025-06-01' existing = {
  name: storageAccountName
}

resource site 'Microsoft.Web/staticSites@2024-11-01' existing = {
  name: staticWebAppName
}

module data './data.bicep' = if (adoptExisting) {
  params: {
    storageAccountName: storageAccountName
  }
}

module settings './appsettings.bicep' = {
  dependsOn: [resources, data]
  params: {
    staticWebAppName: staticWebAppName
    entraClientId: entraClientId
    entraClientSecret: entraClientSecret
    approvedUsersJson: approvedUsersJson
    storageConnectionString: empty(storageConnectionString)
      ? 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'
      : storageConnectionString
  }
}

output staticWebAppResourceId string = site.id
output storageResourceId string = storage.id
output siteUrl string = 'https://${site.properties.defaultHostname}'

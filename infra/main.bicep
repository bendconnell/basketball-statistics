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

resource site 'Microsoft.Web/staticSites@2024-11-01' = {
  name: staticWebAppName
  location: location
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
  properties: {
    provider: 'Custom'
    allowConfigFileUpdates: true
    stagingEnvironmentPolicy: 'Disabled'
    buildProperties: {
      skipGithubActionWorkflowGeneration: true
    }
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2025-06-01' = {
  name: storageAccountName
  location: storageLocation
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    accessTier: 'Hot'
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    // Managed SWA Functions have no managed identity or private-network integration.
    allowSharedKeyAccess: true
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      bypass: 'None'
      defaultAction: 'Allow'
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2025-06-01' = {
  parent: storage
  name: 'default'
  properties: {
    isVersioningEnabled: true
    deleteRetentionPolicy: {
      enabled: true
      days: softDeleteDays
    }
    containerDeleteRetentionPolicy: {
      enabled: true
      days: softDeleteDays
    }
  }
}

resource sessions 'Microsoft.Storage/storageAccounts/blobServices/containers@2025-06-01' = {
  parent: blobService
  name: 'game-sessions'
  properties: {
    publicAccess: 'None'
  }
}

resource tableService 'Microsoft.Storage/storageAccounts/tableServices@2025-06-01' = {
  parent: storage
  name: 'default'
}

resource tables 'Microsoft.Storage/storageAccounts/tableServices/tables@2025-06-01' = [for tableName in ['CompetitionData', 'SessionOperations']: {
  parent: tableService
  name: tableName
}]

module settings './appsettings.bicep' = {
  params: {
    staticWebAppName: site.name
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

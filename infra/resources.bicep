targetScope = 'resourceGroup'

@minLength(2)
param staticWebAppName string

@minLength(3)
@maxLength(24)
param storageAccountName string

param location string
param storageLocation string = location

@minValue(1)
@maxValue(365)
param softDeleteDays int = 14

resource site 'Microsoft.Web/staticSites@2024-11-01' = {
  name: staticWebAppName
  location: location
  tags: {
    application: 'bball-stats'
    repository: 'bendconnell/basketball-statistics'
  }
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
  tags: {
    application: 'bball-stats'
    repository: 'bendconnell/basketball-statistics'
  }
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
      // Retained versions/snapshots must not be purged during the retention window.
      allowPermanentDelete: false
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
    defaultEncryptionScope: '$account-encryption-key'
    denyEncryptionScopeOverride: false
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

output staticWebAppResourceId string = site.id
output storageResourceId string = storage.id
output siteUrl string = 'https://${site.properties.defaultHostname}'

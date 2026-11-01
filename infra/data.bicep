targetScope = 'resourceGroup'

param storageAccountName string

// Adoption never PUTs the account or service parents. Their security/retention
// baseline is checked separately before preview and again before apply.
resource storage 'Microsoft.Storage/storageAccounts@2025-06-01' existing = {
  name: storageAccountName
}
resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2025-06-01' existing = {
  parent: storage
  name: 'default'
}
resource tableService 'Microsoft.Storage/storageAccounts/tableServices@2025-06-01' existing = {
  parent: storage
  name: 'default'
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
resource tables 'Microsoft.Storage/storageAccounts/tableServices/tables@2025-06-01' = [for tableName in ['CompetitionData', 'SessionOperations']: {
  parent: tableService
  name: tableName
}]

export interface IntegrationMcpState {
  connected: boolean
  refresh(): Promise<void>
}

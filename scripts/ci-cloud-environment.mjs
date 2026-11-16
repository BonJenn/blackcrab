// Public Blackcrab Connect settings (account sign-in and relay addresses). A
// release sets them from repository variables; without them the build has no
// Connect, as before. Never a secret: these are readable in every shipped app.
export const CLOUD_SETTINGS=Object.freeze(['BLACKCRAB_CLERK_PUBLISHABLE_KEY','BLACKCRAB_CLERK_JWT_TEMPLATE','BLACKCRAB_RELAY_URL','BLACKCRAB_HOSTED_APP_URL','BLACKCRAB_CLERK_CLI_OAUTH_CLIENT_ID']);
export function cloudEnvironmentFrom(environment=process.env){
  return Object.fromEntries(CLOUD_SETTINGS.filter(name=>typeof environment[name]==='string'&&environment[name].trim()).map(name=>[name,environment[name].trim()]));
}

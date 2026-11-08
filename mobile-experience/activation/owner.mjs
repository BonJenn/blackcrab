/** Process-lifetime boot handoff, never a conditional screen mount/unmount. */
export function makeActivationOwner({verifyExclusiveOwnership,loadFullApp}) {
  if(typeof verifyExclusiveOwnership!=="function"||typeof loadFullApp!=="function")throw new Error("Explicit fresh-process ownership verification is required.");
  let startup;
  return Object.freeze({start(){
    // Sticky success/failure: an import may already have installed global services.
    startup??=Promise.resolve().then(verifyExclusiveOwnership).then(loadFullApp);
    return startup;
  }});
}

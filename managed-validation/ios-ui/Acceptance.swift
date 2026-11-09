import XCTest

/// Review-only. Never installs apps, controls permissions, or selects devices.
final class Acceptance: XCTestCase {
  struct Input: Decodable {
    let nonce: String, expectedNonce: String, phase: String
    let ownedDeviceName: String, ownedDeviceUUID: String
    let sourceRevision: String, hostManifestSHA256: String
    let address: String, pairingCode: String, initialTitle: String, renamedTitle: String
  }
  var input: Input!
  let app = XCUIApplication(bundleIdentifier: "dev.blackcrab.remote")
  override func setUpWithError() throws {
    continueAfterFailure = false
    guard ProcessInfo.processInfo.environment["BLACKCRAB_UI_USER_APPROVED"] == "YES",
          let raw = ProcessInfo.processInfo.environment["BLACKCRAB_UI_INPUT"]?.data(using: .utf8) else {
      throw XCTSkip("Explicit user approval and private, validated fixture input required")
    }
    input = try JSONDecoder().decode(Input.self, from: raw)
    guard input.nonce == input.expectedNonce, UUID(uuidString: input.nonce) != nil,
      input.initialTitle == "Blackcrab QA " + input.nonce,
      input.renamedTitle == input.initialTitle + " renamed",
      UUID(uuidString: input.ownedDeviceUUID) != nil,
      ProcessInfo.processInfo.environment["SIMULATOR_UDID"] == input.ownedDeviceUUID,
      ProcessInfo.processInfo.environment["SIMULATOR_DEVICE_NAME"] == input.ownedDeviceName,
      input.ownedDeviceName.hasPrefix("Blackcrab-C603-"),
      input.sourceRevision == "c6035c6d55f86ec8d2c62cd64424067197f95e10",
      input.hostManifestSHA256 == "afdbaf815be9d676657939f1235290de5765b81ac008f11f3836b7cb80a9041e",
      let url = URL(string: input.address), url.scheme == "http", url.host == "127.0.0.1",
      url.port != nil, url.user == nil, url.password == nil,
      input.pairingCode.range(of: "^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$", options: .regularExpression) != nil
    else { throw XCTSkip("Fixture identity rejected") }
  }
  func exact(_ label: String) -> XCUIElement { app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch }
  func require(_ element: XCUIElement) { XCTAssertTrue(element.waitForExistence(timeout: 30)); XCTAssertTrue(element.isHittable) }
  func completePhase() throws {
    let value = ["kind":"blackcrab-phase-completion-v1", "phase":input.phase,
                 "nonce":input.nonce, "deviceUUID":input.ownedDeviceUUID]
    let attachment = XCTAttachment(data: try JSONSerialization.data(withJSONObject: value), uniformTypeIdentifier: "public.json")
    attachment.name = "blackcrab-phase-completion.json"
    attachment.lifetime = .keepAlways
    add(attachment)
  }
  func testOwnedCatalogPhase() throws {
    // No global interruption monitors: unexpected permission/account UI fails.
    app.terminate(); app.launch()
    if input.phase == "seed-baseline" || input.phase == "logging-canary" {
      let tab = exact("Workspaces"); require(tab); tab.tap()
      let address = app.secureTextFields["Workspace address or pairing link"]
      let code = app.secureTextFields["Workspace pairing code"]
      require(address); require(code)
      // Gate until Apple secure-field activity/xcresult redaction has been proven.
      // Never risk writing a bearer pairing credential into XCTest activity logs.
      guard ProcessInfo.processInfo.environment["BLACKCRAB_PRIVATE_RAW_SINK_CERTIFIED"] == "YES" else {
        throw XCTSkip("Private raw-sink canary must be certified before pairing")
      }
      address.tap(); address.typeText(input.address); code.tap(); code.typeText(input.pairingCode)
      if input.phase == "logging-canary" { app.terminate(); try completePhase(); return }
      let pair = exact("Pair workspace"); require(pair); pair.tap()
      XCTAssertTrue(exact(input.initialTitle).waitForExistence(timeout: 45))
    } else if input.phase == "control-upgraded" {
      let row = exact(input.initialTitle); require(row); row.press(forDuration: 1.2)
      let more = exact("More"); require(more); more.tap()
      let rename = exact("Rename"); require(rename); rename.tap()
      let prompt = app.alerts["Rename thread"]; require(prompt)
      let field = prompt.textFields.firstMatch; require(field)
      field.tap(); field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: input.initialTitle.count) + input.renamedTitle)
      prompt.buttons["Rename"].tap()
      let renamed = exact(input.renamedTitle); require(renamed); renamed.press(forDuration: 1.2)
      let archiveMenu = exact("More"); require(archiveMenu); archiveMenu.tap()
      let archive = exact("Archive"); require(archive); archive.tap()
      XCTAssertTrue(renamed.waitForNonExistence(timeout: 30))
    } else { throw XCTSkip("Unknown phase") }
    // Keep upgraded UI alive until the external SDK verifies its mutation.
    // The controller owns final device shutdown; baseline seed still terminates.
    if input.phase != "control-upgraded" { app.terminate() }
    try completePhase()
  }
}

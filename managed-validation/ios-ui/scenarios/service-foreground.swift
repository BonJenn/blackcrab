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
      input.ownedDeviceName.hasPrefix("Blackcrab-Foreground-"),
      input.sourceRevision == "d1d4d2741a9ffece4b1cf79a5255f667f535fd1e",
      input.hostManifestSHA256 == "9eac410b7393b18f510fe2d59a756880575bfcfe8fa8c171046f36abd1fa7937",
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
    if input.phase == "foreground-control" {
      XCTAssertTrue(app.state == .runningBackground || app.state == .runningBackgroundSuspended)
      app.activate()
      XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
    } else {
      app.terminate(); app.launch()
    }
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
    } else if input.phase == "background-idle" {
      require(exact(input.renamedTitle))
      XCUIDevice.shared.press(.home)
      XCTAssertTrue(app.wait(for: .runningBackground, timeout: 10) || app.state == .runningBackgroundSuspended)
      // Intentionally leave this owned app running in the background. The next
      // phase must activate it, not terminate or relaunch it.
      try completePhase()
      return
    } else if input.phase == "control-upgraded" || input.phase == "foreground-control" {
      let expectedTitle = input.phase == "control-upgraded" ? input.initialTitle : input.initialTitle + " changed in background"
      let nextTitle = input.phase == "control-upgraded" ? input.renamedTitle : input.renamedTitle + " after background"
      let row = exact(expectedTitle); require(row); row.press(forDuration: 1.2)
      let more = exact("More"); require(more); more.tap()
      let rename = exact("Rename"); require(rename); rename.tap()
      let prompt = app.alerts["Rename thread"]; require(prompt)
      let field = prompt.textFields.firstMatch; require(field)
      field.tap()
      XCTAssertEqual(field.value as? String, expectedTitle)
      // The title is one paragraph; use the iOS touch selection gesture.
      field.tap(withNumberOfTaps: 3, numberOfTouches: 1)
      field.typeText(XCUIKeyboardKey.delete.rawValue)
      // Check the edit itself before typing, so a simulator text selection
      // failure cannot be mistaken for a reconnect or metadata mutation defect.
      XCTAssertEqual(field.value as? String, "")
      field.typeText(nextTitle)
      XCTAssertEqual(field.value as? String, nextTitle)
      prompt.buttons["Rename"].tap()
      let renamed = exact(nextTitle); require(renamed); renamed.press(forDuration: 1.2)
      let archiveMenu = exact("More"); require(archiveMenu); archiveMenu.tap()
      let archive = exact("Archive"); require(archive); archive.tap()
      XCTAssertTrue(renamed.waitForNonExistence(timeout: 30))
    } else { throw XCTSkip("Unknown phase") }
    // Completed control phases close this app; background-idle returned above
    // without terminating it so foreground-control proves process retention.
    app.terminate()
    try completePhase()
  }
}

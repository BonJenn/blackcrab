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
      input.ownedDeviceName.hasPrefix("Blackcrab-Accessibility-"),
      input.sourceRevision == "684ee6da757afa406c89de5b4f1ed26553d683ab",
      input.hostManifestSHA256 == "9eac410b7393b18f510fe2d59a756880575bfcfe8fa8c171046f36abd1fa7937",
      let url = URL(string: input.address), url.scheme == "http", url.host == "127.0.0.1",
      url.port != nil, url.user == nil, url.password == nil,
      input.pairingCode.range(of: "^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$", options: .regularExpression) != nil
    else { throw XCTSkip("Fixture identity rejected") }
  }
  func exact(_ label: String) -> XCUIElement { app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch }
  func require(_ element: XCUIElement) {
    XCTAssertTrue(element.waitForExistence(timeout: 30))
    let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"), object: element)
    XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 10), .completed)
  }
  func completePhase() throws {
    let value = ["kind":"blackcrab-phase-completion-v1", "phase":input.phase,
                 "nonce":input.nonce, "deviceUUID":input.ownedDeviceUUID]
    let attachment = XCTAttachment(data: try JSONSerialization.data(withJSONObject: value), uniformTypeIdentifier: "public.json")
    attachment.name = "blackcrab-phase-completion.json"
    attachment.lifetime = .keepAlways
    add(attachment)
  }
  func showEnvironments() {
    let settings = exact("Settings"); require(settings); settings.tap()
    let rows = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Environments, "))
    let environments = rows.firstMatch; require(environments)
    XCTAssertEqual(rows.count, 1); environments.tap()
    require(exact("Add environment"))
  }
  func fillNewPairing() throws {
    guard ProcessInfo.processInfo.environment["BLACKCRAB_PRIVATE_RAW_SINK_CERTIFIED"] == "YES" else {
      throw XCTSkip("Private input sinks must be certified")
    }
    let add = exact("Add environment"); require(add); add.tap()
    let address = app.textFields["Address"], code = app.textFields["Code"]
    require(address); require(code)
    address.tap(); address.typeText(input.address)
    code.tap(); code.typeText(input.pairingCode)
  }
  func requireSummaryValue(_ expected: String) {
    let rows = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@ AND value == %@", "Manage ", expected))
    require(rows.firstMatch)
    XCTAssertEqual(rows.count, 1)
  }
  func showChats() {
    for _ in 0..<4 {
      if exact("Chats").exists && exact("Chats").isHittable { break }
      let back = app.buttons["BackButton"].firstMatch; require(back); back.tap()
    }
    let chats = exact("Chats"); require(chats); chats.tap()
  }
  func testOwnedCatalogPhase() throws {
    // No global interruption monitors: unexpected permission/account UI fails.
    if input.phase == "revoked-native" || input.phase == "repair-native" {
      XCTAssertTrue(app.state == .runningForeground || app.state == .runningBackground || app.state == .runningBackgroundSuspended)
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
    } else if input.phase == "hold-native" {
      require(exact(input.renamedTitle))
      showEnvironments()
      let enabled = app.switches.matching(NSPredicate(format: "label BEGINSWITH %@", "Enable "))
      require(enabled.firstMatch); XCTAssertEqual(enabled.count, 1)
      XCTAssertEqual(enabled.firstMatch.value as? String, "1")
      requireSummaryValue("Connected")
      try completePhase()
      return
    } else if input.phase == "revoked-native" {
      let enabled = app.switches.matching(NSPredicate(format: "label BEGINSWITH %@", "Enable "))
      require(enabled.firstMatch); XCTAssertEqual(enabled.count, 1)
      let hostLabel = String(enabled.firstMatch.label.dropFirst("Enable ".count))
      XCTAssertFalse(hostLabel.isEmpty)
      requireSummaryValue("T3 Code on " + hostLabel + " did not accept this device")
      // The same diagnosis remains available through detailed diagnostics.
      let manage = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Manage ")).firstMatch
      require(manage); manage.tap()
      let expand = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Expand details for ")).firstMatch
      require(expand); expand.tap()
      let denied = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Cause: authentication")).firstMatch
      XCTAssertTrue(denied.waitForExistence(timeout: 45))
      require(exact("Copy diagnostics"))
      let back = app.buttons["BackButton"].firstMatch; require(back); back.tap()
      require(exact("Add environment"))
      try completePhase()
      return
    } else if input.phase == "repair-logging-canary" {
      showEnvironments()
      try fillNewPairing()
      // Nonsecret canary: never submit the invalid address/code.
    } else if input.phase == "repair-native" {
      try fillNewPairing()
      let submit = app.buttons["Add environment"].firstMatch; require(submit); submit.tap()
      XCTAssertTrue(app.textFields["Code"].waitForNonExistence(timeout: 45))
      let enabled = app.switches.matching(NSPredicate(format: "label BEGINSWITH %@", "Enable "))
      XCTAssertTrue(enabled.firstMatch.waitForExistence(timeout: 30))
      XCTAssertEqual(enabled.count, 1)
      let hostLabel = String(enabled.firstMatch.label.dropFirst("Enable ".count))
      XCTAssertFalse(hostLabel.isEmpty)
      // The new grant deliberately narrows scopes. Acknowledge only this app's
      // exact notice for the sole owned host; never handle system permissions.
      let notice = app.alerts["Permissions have changed for " + hostLabel]
      require(notice)
      XCTAssertTrue(notice.staticTexts.matching(NSPredicate(format: "label == %@", "This connection still uses the old permissions, so some actions may no longer be available. Pair again using a new link with the permissions you need.")).firstMatch.exists)
      let acknowledge = notice.buttons["Got it"]; require(acknowledge); acknowledge.tap()
      XCTAssertTrue(notice.waitForNonExistence(timeout: 10))
      require(enabled.firstMatch)
      XCTAssertEqual(enabled.firstMatch.value as? String, "1")
      requireSummaryValue("Connected")
      showChats()
      require(exact(input.initialTitle + " changed after revoke"))
    } else if input.phase == "control-upgraded" || input.phase == "control-repaired" {
      let expectedTitle = input.phase == "control-upgraded" ? input.initialTitle : input.initialTitle + " changed after revoke"
      let nextTitle = input.phase == "control-upgraded" ? input.renamedTitle : input.renamedTitle + " after repair"
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
    // Hold and revoked phases return above without terminating the owned app.
    app.terminate()
    try completePhase()
  }
}

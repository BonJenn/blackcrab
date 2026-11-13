# Split-pane toolbar placement

The owner reported that the rightmost pane's close and move controls were covered
by side-panel buttons. Each ChatView rendered WorkspaceTitlebarControls using a
fixed window-level position, while PaneHeaderControls occupied the trailing edge
of its own header. Multiple panes therefore shared the same floating hit area.

Pane views now place panel toggles in normal header flow after the move/close
buttons while the right panel is closed. With a panel open, its toolbar anchors
to that pane, and the thread-details toggle participates in the chat header's
flow. Single-view window controls retain their existing fixed positioning. The
top-right pane retains native window-caption clearance. Pane controls explicitly
opt out of Electron titlebar dragging.

Regression coverage uses the real toolbar/action components in Chromium with
six panes and both open/closed panels. It checks center-point hit testing for
every move and close button, geometry bounds, no-drag styling and a real close
click on the top-right pane. Exact source tests also verify ChatView wiring.
Actual packaged Mac UI testing remains separate; public 0.4.2 is unchanged.

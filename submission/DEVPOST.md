# Devpost submission text

## Inspection / elevator pitch

Chalkboard is a graphing sandbox an AI agent can actually draw on. Instead of describing
math in prose, the agent grabs the sliders, zooms the viewport and pins labels to the
curve while it explains — so the explanation and the artifact are the same object.

## Why this use case fits WebMCP

Teaching math is a domain where prose is the wrong medium and always has been. "Increasing
`a` makes the parabola narrower" is a sentence a student can read ten times without ever
seeing the motion it describes. The understanding lives in watching the curve tighten while
someone talks over it — which is exactly what a good tutor at a whiteboard does, and exactly
what a chat window cannot do.

The blocker was never the model's ability to explain. It was that the model had no hands.
An agent could describe a graph, or emit an image of one, but it could not reach into a
live, stateful, student-manipulable artifact and move one specific control at one specific
moment in its explanation.

WebMCP is the missing piece specifically because of *whose* agent it is. The student is
already talking to an assistant. The page declares what it can do, and that assistant drives
it — no extension to install, no API key shipped in client JavaScript, no separate chat
sidebar bolted onto the app. The tools are a property of the page, so every agent that
speaks WebMCP inherits them.

## How it improves the user experience

The student keeps a real graphing calculator. Everything is directly manipulable — type an
expression, drag a slider, pan the graph, orbit a 3D surface — and the agent operates the
same controls, through the same code path, on the same state. There is no "agent mode."

Three concrete improvements over asking a chatbot the same question:

1. **The answer is a motion, not a paragraph.** `animate_slider` sweeps a parameter over
   ~2 seconds, dragging the on-screen control while the curve deforms continuously. The
   student sees the causal link rather than reading an assertion about it.
2. **The agent's claims are measured, not estimated.** `find_features` runs a real numeric
   scan and returns coordinates, so the agent says "the vertex is at (1, −4)" because it
   computed it — and `annotate` puts the label exactly there.
3. **The reasoning persists.** Annotations stay pinned to the curve after the conversation
   moves on, so the student is left with a marked-up artifact rather than a scrollback.

## What humans and agents can do together that was hard before

A student can ask a *why* question about a thing they are looking at, and get an answer
performed on that same thing, with no handoff. Concretely: "why does the beat pattern
appear when the two frequencies get close?" — the agent loads the two-wave preset, animates
the frequency offset up from zero, and the envelope emerges on screen while it narrates.
Previously that demonstration had to be pre-built by a human author, one canned animation
per concept. Now it is generated on demand, for the specific question actually asked, on the
student's own working board — including questions the author never anticipated.

It also runs the other direction. The student can drag a slider somewhere strange and ask
"what happened here?", and the agent reads the live state back through `list_expressions`
and `find_features` and explains the board as it currently stands. The artifact is shared
ground both parties can see and touch, which is what makes it a collaboration instead of a
query.

## How WebMCP was implemented

15 tools are registered on `document.modelContext` at page load (`src/tools.js`).

The architectural rule the whole project is built on: **every state change goes through a
single mutation layer** (`src/store.js`). The sliders, the text boxes and the agent tools
all call the same functions. There is no separate agent path that could drift out of sync
with what the student sees, and the renderers are read-only consumers of that state. Panning
the graph with the mouse and calling `set_viewport` are the same operation, so the agent can
always read back where the student actually is.

Three things mattered more than expected:

**Return errors to the agent, not failures.** `add_expression` on malformed input returns
the parser's actual message. The agent reads it, fixes the syntax and retries — the student
never sees the stumble. Tools that merely fail make an agent apologise instead of correct.

**Echo state back on every mutation.** Each mutating tool returns the current expressions,
sliders and viewport, so the agent stays oriented without polling.

**Tool descriptions are the prompt.** "Set a parameter" gets ignored. Saying *when* to reach
for a tool — and when to reach for a different one — is what makes the agent choose
`animate_slider` over `set_slider` at the moment where the motion is the entire point.

Numerically, `find_features` is what lets the agent reason rather than guess: bisection on
sign changes with exact-zero handling, a geometric blow-up probe that distinguishes a
vertical asymptote from the edge of a domain, and the sign of the Hessian determinant to
classify a critical point on a surface as a saddle.

## Built with

JavaScript (no framework, no build step), WebMCP (`document.modelContext`), math.js,
three.js, HTML canvas, GitHub Pages.

## Try it

Open the live URL in the ChatGPT desktop in-app browser, or in Chrome 149+ with
`chrome://flags/#enable-webmcp-testing` enabled, then ask:

- "Load the parabola lesson, then show me why `a` changes the width."
- "Where does y = x³ − 3x cross zero? Label the turning points."
- "Switch to 3D, graph z = x² − y², and orbit so I can see the saddle."

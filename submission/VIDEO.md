# Demo video plan (target 2:20, hard limit 3:00)

Rule for the whole video: it must read with the sound off. Sliders visibly moving and
labels landing on curves carry the story; narration explains it.

Record at 1440x900 or larger, browser zoom 100%, Agent activity panel visible on the right
so tool calls stream in as evidence.

## Shot list

**0:00–0:15 — The problem, stated as a question**
Screen: a student types into the agent: *"Why does increasing a make the parabola
narrower?"*
Narration: "This is the question every algebra student asks. Normally you get a paragraph."

**0:15–0:50 — The answer as a motion (the money shot)**
Screen: agent calls `load_preset` then `animate_slider`. The `a` slider slides across the
screen on its own and the parabola visibly tightens. Do not cut away. Let it play in full.
Narration: "It doesn't describe the change. It moves the slider. The page gave the agent
real controls, so the explanation and the graph are the same object."

**0:50–1:20 — Measured, not guessed**
Screen: *"Where does it cross zero?"* → `find_features` returns roots and the vertex →
`annotate` drops labels exactly on them.
Narration: "It isn't reading coordinates off the picture. find_features runs a numeric scan
and returns real values, so the labels land exactly on the feature."

**1:20–1:50 — 3D, and why camera control matters**
Screen: *"Show me the saddle."* → `set_mode` 3d → surface appears → `set_camera` orbits from
top-down to edge-on, where the saddle becomes visible → annotate "saddle point".
Narration: "A saddle is invisible from directly overhead. The agent orbits to where the
geometry actually reads — the viewpoint is part of the explanation."

**1:50–2:10 — Shared ground, both directions**
Screen: the *human* drags a slider to an extreme, then asks "what happened?" → agent calls
`list_expressions` / `find_features` and explains the current board.
Narration: "Same state, same controls, either party. That's what makes it collaboration
rather than a query."

**2:10–2:25 — Close on architecture, briefly**
Screen: the Agent activity panel scrolled through the session's calls; cut to one code
frame of `document.modelContext.registerTool`.
Narration: "Fifteen tools on document.modelContext. No extension, no API key in the page —
whatever agent the student already uses can drive it."

## Recording notes

- No copyrighted music. Silence or narration only.
- Clear the activity log before the take so calls appear live.
- Use `duration: 2500` on the hero `animate_slider` — 900ms is too fast to read on video.
- Record the browser window only, not the full desktop.

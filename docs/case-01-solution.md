# ⚠️ SPOILERS — Case 01: The Last Guest at Hotel Vesper

This file contains the full solution. Don't read it before you playtest.
The playable content is in `src/cases/case01.ts`. Keep both files in sync.

## The question put to the player

> Where is Julian Marsh now, who put him there, and which record proves that person lied?

## Premise (told to the player)

A storm hits Hotel Vesper, a small hotel on a tidal island. The causeway floods at 10 pm, so nobody can
arrive or leave. Four people are inside: the guest **Julian Marsh** (a rare-book dealer, Room 7), two
other guests, and the night clerk. At breakfast Julian is missing. His bed hasn't been slept in and his
coat is gone, but his car keys, wallet and suitcase are still in his room.

## 1. What actually happened

| Time | Event |
|---|---|
| ~4 pm | Ruth Calloway arrives through the covered front entrance on the paved drive. |
| 8 pm | Dinner. Julian recognises Ruth: years ago, under another name, she sold him a forged atlas in Lisbon. At the same dinner Felix Arden and Julian argue loudly because Julian owes Felix £200. Ruth sees the argument. |
| after dinner | Julian writes in his notebook that he recognised "her" and will go to the police when the road opens. |
| 10 pm | The causeway floods. |
| ~11 pm | Ruth slips a note under Room 7's door. It is written in her **green ink** and signed **"F."** to borrow Felix's quarrel: *"Wine store, half past eleven. Come alone and we'll settle this. — F."* |
| 11:30 | Julian crosses the dug-up clay courtyard to the old stable block, where the wine store is. At the same moment Odile Vance is bringing Felix cocoa in the library while the clock strikes the half hour. |
| ~11:31 | Once Julian is inside the wine store, Ruth slides the heavy outside bolt shut. The storm drowns out his knocking. |
| 11:33 | The power fails. Odile goes to the boiler room (log: 11:34 on site, 11:49 generator running, 11:52 back at the desk). |
| ~11:40 | Ruth returns to her room in the dark. |
| 12:30 | Odile collects shoes left out for polishing. Ruth's are soaked with **red clay on the heels**, and Felix's are dry. Ruth assumed the clay would simply be cleaned off. |

Ruth's plan was to leave on the first crossing when the causeway reopened, before anyone found Julian.
**Julian is alive and unharmed**, just cold and angry, in the wine store.

## 2. Suspects: what they know and what they claim

**Ruth Calloway (guest, "private collector") — responsible.**
Knows everything above.
- *ruth-room*: "I went up at half past ten and didn't leave my room until breakfast."
- *ruth-outside*: "I haven't set foot outside since I arrived at four. You'd have to be mad, in that weather." **FALSE**
- *ruth-stranger*: "I'd never met Mr Marsh before this weekend." **FALSE, but only hinted at by the notebook**

**Dr Felix Arden (guest, physician) — innocent, and framed.**
Knows Julian owes him money and that they argued. Knows Odile brought him cocoa at 11:30.
- *felix-argue*: "Yes, we argued. He owes me £200. Why would I make him vanish before he pays?" TRUE
- *felix-library*: "I read in the library from eleven until one. Odile brought me cocoa at half past eleven; the clock was striking." TRUE
- *felix-pencil*: "My fountain pen leaked all over my case on the drive. I've written nothing but pencil since. I signed the register in pencil." TRUE

**Odile Vance (night clerk) — innocent, but tells a self-protective lie.**
Leaving the desk unattended can get a night clerk dismissed, so she denies doing it.
- *odile-desk*: "I was at the front desk all night. I never left it." **FALSE**
- *odile-nobody*: "Nobody went out through the front hall." TRUE (the courtyard is reached through the back garden door)

## 3. What each clue proves

| # | Evidence | Where | Proves |
|---|---|---|---|
| E1 | **The note** | Room 7 | Julian was lured to the **wine store at 11:30**. It is written in **green ink** and signed "F." |
| E2 | **Julian's notebook** | Room 7 | Julian recognised a woman at dinner as the seller of a forged atlas and meant to go to the police (motive). He also owes F. £200 and wants to "settle it quietly", which explains why an "F." note would work on him. |
| E3 | **Guest register** | Front desk | Julian signed in black ink, Felix in **pencil** ("pen leaked"), Ruth in **green ink**, and Odile initialled in the desk's blue ink. Only Ruth uses green ink. |
| E4 | **Shoe-polishing list** | Back corridor | At 12:30, Room 3 (Calloway) was "soaked, red clay caked on heels", Room 5 (Arden) was "dry", and Room 7 had no shoes out. |
| E5 | **Generator logbook** | Boiler room | Power was lost at 11:33, "O. Vance" was on site at 11:34, the generator was running at 11:49, and Odile was back at the desk at 11:52. |
| E6 | **Groundsman's notice** | Garden door | The courtyard path is dug up and **red clay** is everywhere. The stable block and wine store can **only** be reached across it. The wine store door sticks, so it must be **bolted from outside**. The front drive is paved and covered. |

## 4. Contradictions (the game detects these)

| Claim | Evidence | Why they conflict |
|---|---|---|
| **ruth-outside** | **E4 shoe list** | Red clay exists only in the courtyard (E6), and her shoes were caked with it at 12:30. **Key contradiction.** |
| odile-desk | E5 generator log | Her own signature puts her in the boiler room from 11:34 to 11:52. This is a red herring: it gives her an alibi instead of implicating her. |
| odile-desk | E4 shoe list | She collected shoes from the upstairs corridor at 12:30, so she left the desk. |

Supporting signals that the game does not flag: *ruth-stranger* against E2 (the notebook says "her", and Ruth was the
only woman at dinner, but that fact comes from the premise, not a clue), and *odile-desk* against *felix-library*.

## 5. Why the solution fits and the alternatives don't

**Intended answer: the wine store, Ruth Calloway, and the shoe-polishing list.**
- The note (E1) names the place and time. Its green ink matches only Ruth's register signature (E3).
- The only way to the wine store crosses the clay courtyard (E6). Ruth's shoes carried that clay (E4), although she says she never went outside.
- Motive: Julian was about to expose her (E2).
- The door bolts from outside (E6), which explains how he was kept there.

**Felix?** The note says "F.", but it isn't in his pencil (E3, *felix-pencil*). His shoes were dry (E4). At 11:30 Odile
was with him in the library. He is owed money, so he needs Julian present. A culprit also wouldn't sign their own initial.

**Odile?** She lied, but the lie hides the fact that she was in the boiler room from 11:34 to 11:52 (E5). At 11:30
she was with Felix. Nothing links her to green ink or to the note.

**Boiler room or library as Julian's location?** Odile and Felix were in those rooms during the window, and nothing
places Julian there. **Left the island?** The causeway was flooded, and his car keys and wallet are still in his room.

**Why trust the shoe list, written by a clerk who lied?** It was written at 12:30, before anyone knew Julian was
missing, so Odile had no reason to falsify it. Her own lie was about her own absence, and her own log exposes it.

## Self-review notes (weaknesses we accept for the prototype)

- The location is fairly direct once the note is read. The real challenge is *who*. That suits a 5–10 minute slice.
- Felix and Odile give each other an alibi at 11:30. In principle they could have colluded, but no evidence
  supports collusion, and the green ink and clay still point away from them.
- Ruth could claim that someone borrowed her pen. That wouldn't explain the clay on her shoes.
- "Only the three guests were at dinner" and "only four people in the hotel" come from the premise, not from clues.
- The Lisbon forgery is backstory told through the notebook. Nothing else corroborates it.
- The clue for the third deduction question has to be the shoe list. The notebook contradicts *ruth-stranger*
  too, but it doesn't name her, so it isn't accepted.

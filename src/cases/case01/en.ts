import type { CaseText } from '../../engine/types';

// English text for Case 01. Keys must match rules.ts; the Russian version is ru.ts.

export const en: CaseText = {
  title: 'The Last Guest at Hotel Vesper',
  tagline: 'A storm. A flooded causeway. One room left empty.',
  intro: [
    'Hotel Vesper sits alone on a tidal island, joined to the mainland by a single stone causeway. Last night a storm rolled in off the sea, and at ten o’clock the causeway went under. No one could arrive and no one could leave.',
    'Four people spent the night inside: the rare-book dealer Julian Marsh (Room 7), two other guests, and the night clerk.',
    'This morning Julian did not come down to breakfast. His bed has not been slept in and his coat is gone, but his car keys, wallet and suitcase are still in his room.',
    'The water will fall by noon and the police will cross. The manager has asked you to make sense of it before they do.',
  ],
  question: 'Where is Julian Marsh now, who put him there, and which record proves that person lied?',

  evidence: {
    note: {
      name: 'Folded note',
      foundAt: 'Room 7 — on the writing desk',
      summary: 'A short message on hotel notepaper.',
      artLabel: 'Folded hotel notepaper',
      body: [
        'Hotel Vesper notepaper, folded twice. The handwriting is quick and slanted, in green ink.',
        '“Wine store, half past eleven. Come alone and we’ll settle this. — F.”',
        'A crease suggests it was slid under the door.',
      ],
    },
    notebook: {
      name: 'Julian’s pocket notebook',
      foundAt: 'Room 7 — inside the suitcase lid',
      summary: 'Julian’s private jottings from last night.',
      artLabel: 'Leather pocket notebook',
      body: [
        'Most pages are auction prices. The last entry, in Julian’s black ink, is dated yesterday:',
        '“Dinner. Recognised her the moment she sat down — the Lisbon seller of that ‘atlas’. Forged, every page of it. Different name now. When the road opens I go straight to the police.”',
        '“Also: owe F. £200. He made a scene at the table. Must settle it quietly before he makes another.”',
      ],
    },
    register: {
      name: 'Guest register',
      foundAt: 'Front desk',
      summary: 'Yesterday’s arrivals, signed by each guest.',
      artLabel: 'Open guest register',
      body: [
        'Yesterday’s page. Each guest signs on arrival; the clerk initials each line.',
        'Rm 3 — Mrs Ruth Calloway, private collector. Signed in green ink. Clerk: O.V. (blue ink)',
        'Rm 5 — Dr Felix Arden. Signed in pencil, with a note: “pen leaked — apologies.” Clerk: O.V. (blue ink)',
        'Rm 7 — Mr Julian Marsh, books & manuscripts. Signed in black ink. Clerk: O.V. (blue ink)',
      ],
    },
    shoes: {
      name: 'Shoe-polishing list',
      foundAt: 'Back corridor — pinned beside the boot cupboard',
      summary: 'The night clerk’s list of shoes collected for cleaning.',
      artLabel: 'Handwritten boot-room list',
      body: [
        'Guests leave their shoes outside their doors to be polished overnight. The list is in the clerk’s blue ink.',
        '12:30 — collected from the upstairs corridor:',
        'Rm 3 (Calloway): one pair walking shoes. Soaked through. Red clay caked on both heels.',
        'Rm 5 (Arden): one pair brogues. Dry. Dusty.',
        'Rm 7 (Marsh): none put out.',
        '— O.V.',
      ],
    },
    generator: {
      name: 'Generator logbook',
      foundAt: 'Boiler room',
      summary: 'Staff entries whenever the backup generator is used.',
      artLabel: 'Oil-stained logbook',
      body: [
        'A grubby logbook hanging from a nail by the generator. Last night’s entries:',
        '11:33 — mains power lost (storm).',
        '11:34 — O. Vance on site. Generator will not start. Cleaning the plug.',
        '11:49 — generator running. Lights restored.',
        '11:52 — back to front desk. — O.V.',
      ],
    },
    notice: {
      name: 'Groundsman’s notice',
      foundAt: 'Back garden door',
      summary: 'A warning taped to the glass of the garden door.',
      artLabel: 'Taped paper notice',
      body: [
        '“GUESTS PLEASE NOTE. The courtyard path is dug up for new drains. Red clay everywhere — mind your shoes.”',
        '“The old stable block (wine store, garden tools) can only be reached across the courtyard, through this door.”',
        '“The wine store door sticks and swings open. Always BOLT IT FROM OUTSIDE when you leave.”',
        '“The front drive is paved and the entrance porch is covered. Please use it for cars and luggage.”',
      ],
    },
  },

  suspects: {
    ruth: {
      name: 'Ruth Calloway',
      role: 'Guest, Room 3 — private collector',
      description: 'Silver-haired and exact, with a traveller’s tan. She keeps her gloves on indoors.',
      artLabel: 'Portrait: Ruth Calloway',
    },
    felix: {
      name: 'Dr Felix Arden',
      role: 'Guest, Room 5 — physician',
      description: 'Big, rumpled and short-tempered. He does not hide his dislike of Julian.',
      artLabel: 'Portrait: Dr Felix Arden',
    },
    odile: {
      name: 'Odile Vance',
      role: 'Night clerk',
      description: 'Young, tired and careful. She answers every question a beat too quickly.',
      artLabel: 'Portrait: Odile Vance',
    },
  },

  claims: {
    'ruth-room': 'I went up at half past ten and did not leave my room until breakfast.',
    'ruth-outside': 'I haven’t set foot outside since I arrived at four. You would have to be mad, in that weather.',
    'ruth-stranger': 'I had never met Mr Marsh before this weekend.',
    'felix-argue': 'Yes, we argued at dinner. He owes me two hundred pounds. Why would I make him vanish before he pays?',
    'felix-library': 'I read in the library from eleven until one. Odile brought me cocoa at half past eleven. The clock was striking.',
    'felix-pencil': 'My fountain pen leaked all over my case on the drive in. I have written nothing but pencil since.',
    'odile-desk': 'I was at the front desk all night. I never left it.',
    'odile-nobody': 'Nobody went out through the front hall. Not Mr Marsh, not anyone.',
  },

  contradictions: {
    'ruth-outside|shoes':
      'Ruth’s shoes were soaked and caked with red clay at half past midnight. By her own account she never went outside, yet her shoes were in the rain and the clay.',
    'odile-desk|generator':
      'Odile’s own signature puts her in the boiler room from 11:34 to 11:52. She did leave the desk. The question is whether that matters.',
    'odile-desk|shoes':
      'Someone collected the shoes from the upstairs corridor at 12:30, and the list is initialled O.V. Odile left the desk at least once more.',
  },
  noContradictionText:
    'You hold the two side by side. Nothing here proves that statement false. Perhaps another record will.',

  hints: [
    'Two people have told you something a written record disputes. Challenge each statement against the evidence and see which ones break.',
    'Odile’s lie tells you where she was, not what happened to Julian. Look at the note instead: who could have written it, and how would they reach the place it names?',
    'The note is in green ink. Compare it with the ink in the guest register. The only way to the wine store crosses the clay courtyard. Whose shoes came back covered in clay?',
  ],

  deduction: {
    where: {
      prompt: 'Where is Julian Marsh now?',
      options: {
        'wine-store': 'Bolted in the wine store',
        'boiler-room': 'In the boiler room',
        library: 'Hidden in the library',
        mainland: 'Gone across the causeway',
      },
    },
    who: {
      prompt: 'Who put him there?',
      options: { ruth: 'Ruth Calloway', felix: 'Dr Felix Arden', odile: 'Odile Vance' },
    },
    proof: {
      prompt: 'Which record proves that person went outside that night?',
      options: {
        note: 'Folded note',
        notebook: 'Julian’s pocket notebook',
        register: 'Guest register',
        shoes: 'Shoe-polishing list',
        generator: 'Generator logbook',
        notice: 'Groundsman’s notice',
      },
    },
  },

  solution: {
    headline: 'Ruth Calloway bolted Julian Marsh in the wine store.',
    explanation: [
      'At dinner Julian recognised Ruth as the woman who had once sold him a forged atlas under another name. He wrote that he would go to the police as soon as the road opened.',
      'Ruth had watched Julian quarrel with Felix about money. She wrote a note in her own green ink, signed it “F.” and slid it under Julian’s door. Julian wanted to settle his debt quietly, so he went.',
      'The wine store stands across the dug-up clay courtyard. When Julian stepped inside, Ruth slid the heavy outside bolt shut. The storm swallowed his knocking. Minutes later the power failed, and she came back in the dark.',
      'She put her shoes out to be polished, expecting the clay to be cleaned away. Instead the night clerk wrote it down at 12:30, before anyone knew Julian was missing, so there was no reason to invent it.',
      'Felix was framed. His pen had leaked, so he wrote only in pencil. His shoes were dry, and at half past eleven Odile was with him in the library. He is owed money, so he needs Julian around.',
      'Odile lied to protect her job: she had left the desk to restart the generator. Her own log places her in the boiler room from 11:34 to 11:52, not in the courtyard.',
      'When the staff unbolted the wine store, they found Julian unharmed: cold, stiff and furious, wrapped in a tablecloth among the racks. Ruth was packed and waiting for the tide.',
    ],
  },

  art: {
    cover: 'Hotel Vesper at night in the storm, causeway under water',
    reveal: 'The wine store door, bolt drawn back, lantern light inside',
  },
};

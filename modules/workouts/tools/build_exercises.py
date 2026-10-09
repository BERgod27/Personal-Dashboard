#!/usr/bin/env python3
"""Builds the Workouts exercise library from hasaneyldrm/exercises-dataset.

    git clone --depth 1 https://github.com/hasaneyldrm/exercises-dataset /tmp/exercises-dataset
    python3 modules/workouts/tools/build_exercises.py /tmp/exercises-dataset/data/exercises.json

Writes two files next to workouts.js:
  exercises.js        names, muscle group, equipment and secondary muscles (loaded with the page)
  exercise-howto.js   English step-by-step instructions (loaded the first time you open "How to")

Only the dataset's MIT-licensed text is used (names, body parts, targets, equipment,
instructions). Its images and animations are under separate terms and are not copied.
The same dataset feeds openGym (github.com/alexpcosta/opengym); its muscle aliasing
idea is reimplemented here for this module's 13 muscle groups.
"""
import json
import re
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent

LICENSE = """MIT License

Copyright (c) 2026 Hasan Emir Yıldırım

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation and data files (the "Software"),
to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE."""

# Dataset muscle names (target and secondary) -> this module's muscle groups.
MUSCLE = {
    'abs': 'core', 'core': 'core', 'abdominals': 'core', 'lower abs': 'core', 'obliques': 'core',
    'hip flexors': 'core', 'serratus anterior': 'chest',
    'pectorals': 'chest', 'chest': 'chest', 'upper chest': 'chest',
    'lats': 'back', 'latissimus dorsi': 'back', 'upper back': 'back', 'back': 'back', 'spine': 'back',
    'lower back': 'back', 'rhomboids': 'back', 'traps': 'back', 'trapezius': 'back', 'levator scapulae': 'back',
    'delts': 'shoulders', 'shoulders': 'shoulders', 'deltoids': 'shoulders', 'rear deltoids': 'shoulders',
    'rotator cuff': 'shoulders',
    'biceps': 'biceps', 'brachialis': 'biceps', 'triceps': 'triceps',
    'forearms': 'forearms', 'wrists': 'forearms', 'wrist flexors': 'forearms', 'wrist extensors': 'forearms',
    'grip muscles': 'forearms',
    'quads': 'quads', 'quadriceps': 'quads', 'adductors': 'quads', 'inner thighs': 'quads', 'groin': 'quads',
    'hamstrings': 'hamstrings', 'glutes': 'glutes', 'abductors': 'glutes',
    'calves': 'calves', 'soleus': 'calves', 'shins': 'calves',
    'cardiovascular system': 'cardio',
}

EQUIPMENT = {
    'body weight': 'Bodyweight', 'weighted': 'Weighted', 'assisted': 'Machine',
    'leverage machine': 'Machine', 'sled machine': 'Machine', 'smith machine': 'Smith machine',
    'barbell': 'Barbell', 'olympic barbell': 'Barbell', 'trap bar': 'Barbell', 'ez barbell': 'EZ bar',
    'dumbbell': 'Dumbbell', 'kettlebell': 'Kettlebell', 'cable': 'Cable', 'rope': 'Cable',
    'band': 'Band', 'resistance band': 'Band',
    'stability ball': 'Ball', 'bosu ball': 'Ball', 'medicine ball': 'Ball',
    'roller': 'Roller', 'wheel roller': 'Roller',
}

# The names already in workouts.js keep their name (it is what people have logged);
# they borrow how-to steps and secondary muscles from the closest dataset entry,
# and that entry is left out of the list so it doesn't show up twice.
ALIAS = {
    'Bench press': 'barbell bench press', 'Incline bench press': 'barbell incline bench press',
    'Dumbbell bench press': 'dumbbell bench press', 'Incline dumbbell press': 'dumbbell incline bench press',
    'Chest fly': 'lever seated fly', 'Cable crossover': 'cable cross-over variation', 'Push-up': 'push-up',
    'Chest press': 'lever chest press', 'Deadlift': 'barbell deadlift', 'Pull-up': 'pull-up', 'Chin-up': 'chin-up',
    'Lat pulldown': 'cable lat pulldown full range of motion', 'Barbell row': 'barbell bent over row',
    'Dumbbell row': 'dumbbell bent over row', 'Seated cable row': 'cable seated row',
    'Back extension': 'hyperextension', 'Overhead press': 'dumbbell standing overhead press',
    'Dumbbell shoulder press': 'dumbbell seated shoulder press', 'Lateral raise': 'dumbbell lateral raise',
    'Cable lateral raise': 'cable lateral raise', 'Front raise': 'dumbbell front raise',
    'Rear delt fly': 'dumbbell rear fly', 'Arnold press': 'dumbbell arnold press', 'Shrug': 'dumbbell shrug',
    'Barbell curl': 'barbell curl', 'Dumbbell curl': 'dumbbell biceps curl', 'Hammer curl': 'dumbbell hammer curl',
    'Preacher curl': 'lever preacher curl', 'Cable curl': 'cable curl', 'Incline dumbbell curl': 'dumbbell incline curl',
    'Triceps pushdown': 'cable pushdown', 'Skull crusher': 'barbell lying triceps extension skull crusher',
    'Overhead triceps extension': 'dumbbell seated triceps extension',
    'Close-grip bench press': 'barbell close-grip bench press', 'Dips': 'chest dip',
    'Wrist curl': 'barbell wrist curl', "Farmer's walk": 'farmers walk', 'Plank': 'weighted front plank',
    'Crunch': 'crunch floor', 'Hanging leg raise': 'hanging leg raise', 'Cable crunch': 'cable kneeling crunch',
    'Russian twist': 'russian twist', 'Squat': 'barbell full squat', 'Front squat': 'barbell front squat',
    'Leg press': 'sled 45° leg press', 'Leg extension': 'lever leg extension', 'Walking lunge': 'walking lunge',
    'Bulgarian split squat': 'dumbbell single leg split squat', 'Hack squat': 'sled hack squat',
    'Goblet squat': 'kettlebell goblet squat', 'Romanian deadlift': 'barbell romanian deadlift',
    'Lying leg curl': 'lever lying leg curl', 'Seated leg curl': 'lever seated leg curl',
    'Good morning': 'barbell good morning', 'Glute bridge': 'low glute bridge on floor',
    'Cable kickback': 'cable kickback', 'Hip abduction': 'lever seated hip abduction',
    'Standing calf raise': 'lever standing calf raise', 'Seated calf raise': 'lever seated calf raise',
    'Cycling': 'stationary bike walk', 'Elliptical': 'walk elliptical cross trainer',
    'Stair climber': 'walking on stepmill', 'Walking': 'walking on incline treadmill', 'Jump rope': 'jump rope',
}


def clean_name(n):
    n = n.replace('в°', '°')                       # mojibake in a few rows
    n = re.sub(r'\s*\((male|female)\)', '', n)      # same move, different model
    n = re.sub(r'\s+', ' ', n).strip()
    return n[:1].upper() + n[1:]


def secondary(r, muscle):
    sec = []
    for m in r.get('secondary_muscles') or []:
        g = MUSCLE.get(m)
        if g and g != muscle and g != 'cardio' and g not in sec:
            sec.append(g)
    return ' '.join(sec)


def main(src):
    rows = json.loads(Path(src).read_text(encoding='utf-8'))
    by_name = {clean_name(r['name']).lower(): r for r in rows}
    alias, used = {}, set()
    for cur, ds in ALIAS.items():
        r = by_name.get(clean_name(ds).lower())
        if not r:
            print('alias not found:', cur, '->', ds, file=sys.stderr)
            continue
        alias[cur.lower()] = [r['id'], secondary(r, None)]
        used.add(r['id'])

    seen = {k.lower() for k in ALIAS}
    lib, howto = [], {}
    for r in sorted(rows, key=lambda r: clean_name(r['name']).lower()):
        steps = (r.get('instruction_steps') or {}).get('en') or []
        if steps:
            howto[r['id']] = steps
        if r['id'] in used:
            continue
        name = clean_name(r['name'])
        base = re.sub(r' v\. ?\d+$', '', name)
        # "X v. 2" is a camera-angle variant; keep it only when there is no plain X
        if base != name and base.lower() in by_name:
            continue
        if re.search(r'\((back|side) pov\)$', name):
            continue
        if name.lower() in seen:
            continue
        seen.add(name.lower())
        cardio = r.get('body_part') == 'cardio'
        muscle = 'cardio' if cardio else MUSCLE.get(r.get('target'), 'other')
        if r.get('body_part') == 'neck':
            muscle = 'other'
        equip = 'Cardio' if cardio else EQUIPMENT.get(r.get('equipment'), 'Other')
        lib.append([name, muscle, equip, secondary(r, muscle), r['id']])

    head = ('/* Generated by tools/build_exercises.py from hasaneyldrm/exercises-dataset\n'
            ' * (https://github.com/hasaneyldrm/exercises-dataset), text and data only.\n * ' +
            LICENSE.replace('\n', '\n * ').replace(' * \n', ' *\n') + '\n */\n')
    meta = {'source': 'hasaneyldrm/exercises-dataset', 'alias': alias, 'list': lib}
    (OUT / 'exercises.js').write_text(
        head + 'window.WorkoutExercises = ' + json.dumps(meta, ensure_ascii=False, separators=(',', ':'))
        .replace('],[', '],\n[') + ';\n', encoding='utf-8')
    (OUT / 'exercise-howto.js').write_text(
        head + 'window.WorkoutExerciseHowTo = ' + json.dumps(howto, ensure_ascii=False, separators=(',', ':'))
        .replace('],"', '],\n"') + ';\n', encoding='utf-8')
    print(len(lib), 'exercises,', len(howto), 'with steps,', len(alias), 'aliases')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'exercises.json')

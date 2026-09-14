export interface Rival {
  id: string;
  name: string;
  tag: string;
  /** career rank in the black list (1 = top) */
  rank: number;
  /** portrait id for <Portrait/> (src/ui/Portrait.tsx) */
  portrait: 'sqwore' | 'glwzbll' | 'prince' | 'madkid';
  accent: string;
  carId: string;
  color: string;
  /** AI skill multiplier for the rival in the career race */
  skill: number;
  before: string[];
  win: string[];
  lose: string[];
}

export const RIVALS: Record<string, Rival> = {
  sqwore: {
    id: 'sqwore',
    name: 'sqwore',
    tag: '№3 в Чёрном списке',
    rank: 3,
    portrait: 'sqwore',
    accent: '#9b5de5',
    carId: 'supra',
    color: '#9b5de5',
    skill: 0.98,
    before: [
      'Йоу, фрешмен. Слышал, ты хочешь в Чёрный список?',
      'Два круга по центру Щёлково: набережная, розовый мост, стела у музея. Проиграешь — отдаёшь ключи и идёшь домой пешком.',
      'Бас на максимум. Погнали.',
    ],
    win: [
      'Ладно… тебе просто повезло на Пролетарском мосту.',
      'Но дальше — Питер, Лиговский. Там тебя ждёт glwzbll, а он не такой добрый, как я.',
    ],
    lose: ['Ха. Иди учи матчасть, салага.', 'Мой бит всё ещё самый плотный в этом городе.'],
  },
  glwzbll: {
    id: 'glwzbll',
    name: 'glwzbll',
    tag: '№2 в Чёрном списке',
    rank: 2,
    portrait: 'glwzbll',
    accent: '#3a86ff',
    carId: 'gt40',
    color: '#3a86ff',
    skill: 1.02,
    before: [
      'sqwore сказал, твоя басуха лупит нормально. Посмотрим, как она лупит на Лиговском.',
      'Невский, площадь Восстания, мимо «Галереи» и Лиговского, 50. Рельсы мокрые — не зевай.',
      'Не тормози у вокзала. Или тормози — мне же лучше.',
    ],
    win: ['Чёрт. Трамвайные рельсы на Свечном меня развернули…', 'Ты реально раздал стиля. Но Принц ждёт в Варшаве у Дворца культуры. Снег и слякоть не прощают.'],
    lose: ['Слишком медленный флекс для Питера.', 'Научись валить боком, потом приходи.'],
  },
  prince: {
    id: 'prince',
    name: 'Тёмный Принц',
    tag: '№1 в Чёрном списке',
    rank: 1,
    portrait: 'prince',
    accent: '#e71d36',
    carId: 'm8',
    color: '#e71d36',
    skill: 1.06,
    before: [
      'Вот мы и встретились. Варшава, центр.',
      'Круг вокруг Дворца культуры: Маршалковская, Иерусалимские аллеи, Яна Павла. Мой заряженный M8 против твоей развалюхи.',
      'На асфальте снег. Побеждает тот, кто не боится заноса. Покажи, на что способен.',
    ],
    win: [
      'Невозможно… В Варшаве короли не меняются. Не менялись.',
      'Ты №1 в Чёрном списке. Но город принадлежит не нам. Он принадлежит МЭДКИДУ.',
      'Он ждёт тебя в Питере, во дворе у 1703. Лиговский, 50.',
    ],
    lose: ['Я же говорил. В Варшаве короли не меняются.', 'Возвращайся, когда научишься ездить.'],
  },
  madkid: {
    id: 'madkid',
    name: 'МЭДКИД',
    tag: 'Крёстный отец города',
    rank: 0,
    portrait: 'madkid',
    accent: '#ffd400',
    carId: 'bolide',
    color: '#ffd400',
    skill: 1.1,
    before: [
      'Добро пожаловать во двор у 1703. Думал, ты тут самый быстрый? На колёсах меня не обогнать — я и не езжу.',
      'Я хожу. Четырнадцать метров стали, гангстерская шляпа и золотая цепь.',
      'Выходи из тачки. Базука на земле. Попробуй свалить меня, пока я не сравнял с асфальтом весь район.',
    ],
    win: [
      'Не-е-ет… Мой мех… Моя цепь…',
      'Ладно. Город твой. Все тачки твои. Золотая краска — тоже твоя.',
      'Но в следующий раз я приду на восемнадцатиметровом.',
    ],
    lose: ['Ха-ха-ха! Ракеты, лазер, зомби — и ты сдулся на первой фазе.', 'Попробуй ещё раз, нуб.'],
  },
};

export interface CareerStage {
  id: string;
  kind: 'race' | 'boss';
  trackId?: string;
  rivalId: string;
  /** wins required to unlock */
  requiresWins: number;
  reward: number;
}

export const CAREER: CareerStage[] = [
  { id: 'c1', kind: 'race', trackId: 'shchyolkovo', rivalId: 'sqwore', requiresWins: 0, reward: 4000 },
  { id: 'c2', kind: 'race', trackId: 'ligovsky', rivalId: 'glwzbll', requiresWins: 1, reward: 7000 },
  { id: 'c3', kind: 'race', trackId: 'warsaw', rivalId: 'prince', requiresWins: 2, reward: 12000 },
  { id: 'boss', kind: 'boss', rivalId: 'madkid', requiresWins: 3, reward: 30000 },
];

import { t } from '../i18n';
const COCO: Record<string, string> = {
  get person() { return t('common.persona'); }, get bicycle() { return t('labels.bicicleta'); }, get car() { return t('labels.coche'); }, get motorcycle() { return t('labels.motocicleta'); }, get airplane() { return t('labels.avion'); }, get bus() { return t('labels.autobus'); },
  get train() { return t('labels.tren'); }, get truck() { return t('labels.camion'); }, get boat() { return t('labels.barco'); }, get 'traffic light'() { return t('labels.semaforo'); }, get 'fire hydrant'() { return t('labels.hidrante'); },
  get 'stop sign'() { return t('labels.senal_de_alto'); }, get 'parking meter'() { return t('labels.parquimetro'); }, get bench() { return t('labels.banca'); }, get bird() { return t('labels.ave'); }, get cat() { return t('labels.gato'); }, get dog() { return t('labels.perro'); },
  get horse() { return t('labels.caballo'); }, get sheep() { return t('labels.oveja'); }, get cow() { return t('labels.vaca'); }, get elephant() { return t('labels.elefante'); }, get bear() { return t('labels.oso'); }, get zebra() { return t('labels.cebra'); }, get giraffe() { return t('labels.jirafa'); },
  get backpack() { return t('labels.mochila'); }, get umbrella() { return t('labels.paraguas'); }, get handbag() { return t('labels.bolso'); }, get tie() { return t('labels.corbata'); }, get suitcase() { return t('labels.maleta'); }, get frisbee() { return t('labels.disco'); },
  get skis() { return t('labels.esquis'); }, get snowboard() { return t('labels.tabla_de_nieve'); }, get 'sports ball'() { return t('labels.pelota'); }, get kite() { return t('labels.papalote'); }, get 'baseball bat'() { return t('labels.bate'); },
  get 'baseball glove'() { return t('labels.guante'); }, get skateboard() { return t('labels.patineta'); }, get surfboard() { return t('labels.tabla_de_surf'); }, get 'tennis racket'() { return t('labels.raqueta'); },
  get bottle() { return t('common.botella'); }, get 'wine glass'() { return t('labels.copa'); }, get cup() { return t('labels.taza'); }, get fork() { return t('labels.tenedor'); }, get knife() { return t('labels.cuchillo'); }, get spoon() { return t('labels.cuchara'); }, get bowl() { return t('labels.tazon'); },
  get banana() { return t('labels.platano'); }, get apple() { return t('labels.manzana'); }, get sandwich() { return t('labels.sandwich'); }, get orange() { return t('labels.naranja'); }, get broccoli() { return t('labels.brocoli'); }, get carrot() { return t('labels.zanahoria'); },
  get 'hot dog'() { return t('labels.hot_dog'); }, get pizza() { return t('labels.pizza'); }, get donut() { return t('labels.dona'); }, get cake() { return t('labels.pastel'); }, get chair() { return t('labels.silla'); }, get couch() { return t('labels.sofa'); },
  get 'potted plant'() { return t('labels.planta'); }, get bed() { return t('labels.cama'); }, get 'dining table'() { return t('labels.mesa'); }, get toilet() { return t('labels.inodoro'); }, get tv() { return t('labels.television'); }, get laptop() { return t('labels.laptop'); },
  get mouse() { return t('labels.raton'); }, get remote() { return t('labels.control'); }, get keyboard() { return t('labels.teclado'); }, get 'cell phone'() { return t('labels.celular'); }, get microwave() { return t('labels.microondas'); }, get oven() { return t('labels.horno'); },
  get toaster() { return t('labels.tostador'); }, get sink() { return t('labels.fregadero'); }, get refrigerator() { return t('labels.refrigerador'); }, get book() { return t('labels.libro'); }, get clock() { return t('labels.reloj'); }, get vase() { return t('labels.florero'); },
  get scissors() { return t('labels.tijeras'); }, get 'teddy bear'() { return t('labels.oso_de_peluche'); }, get 'hair drier'() { return t('labels.secadora'); }, get toothbrush() { return t('labels.cepillo_de_dientes'); },
};

const ANIMALS = new Set(['bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe']);

export const cocoLabel = (name: string) => COCO[name] ?? name;
export const isAnimal = (name: string) => ANIMALS.has(name);

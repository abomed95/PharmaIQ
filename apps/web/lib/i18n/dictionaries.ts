/**
 * Dictionnaires FR / Somali / Arabe / Anglais.
 *
 * Le français est la référence : le type `Dictionary` en est dérivé, donc une
 * clé oubliée dans une autre langue est une erreur de compilation.
 */

export const fr = {
  common: {
    appName: 'PharmaIQ',
    search: 'Rechercher',
    save: 'Enregistrer',
    cancel: 'Annuler',
    confirm: 'Valider',
    loading: 'Chargement…',
    empty: 'Aucune donnée',
    error: 'Une erreur est survenue',
    quantity: 'Quantité',
    price: 'Prix',
    total: 'Total',
    today: "Aujourd'hui",
    days: 'jours',
    logout: 'Déconnexion',
  },
  nav: {
    dashboard: 'Tableau de bord',
    pos: 'Caisse',
    products: 'Produits',
    stock: 'Stock',
    purchases: 'Achats',
    sales: 'Ventes',
    customers: 'Clients',
    suggestions: 'Suggestions',
    assistant: 'Assistant',
    settings: 'Paramètres',
  },
  dashboard: {
    revenueToday: "Ventes aujourd'hui",
    revenueWindow: 'Ventes 30 jours',
    profit: 'Bénéfice',
    stockValue: 'Valeur du stock',
    lowStock: 'Stock bas',
    outOfStock: 'Ruptures',
    expiring: 'Périment bientôt',
    topProducts: 'Meilleures ventes',
    noSales: 'Aucune vente enregistrée pour le moment',
  },
  pos: {
    title: 'Caisse',
    searchPlaceholder: 'Nom du médicament ou code-barres',
    cart: 'Panier',
    emptyCart: 'Panier vide',
    discount: 'Remise',
    tax: 'Taxe',
    paid: 'Montant reçu',
    change: 'Monnaie à rendre',
    due: 'Reste à payer',
    paymentMethod: 'Mode de paiement',
    checkout: 'Encaisser',
    receipt: 'Ticket',
    outOfStock: 'Stock insuffisant',
    saleDone: 'Vente enregistrée',
  },
  receipts: {
    title: 'Photo de reçu',
    takePhoto: '📷 Photographier un reçu',
    analyzing: 'Lecture du reçu par l’IA…',
    verify: 'Vérifie les lignes avant de valider',
    recognized: 'reconnu',
    newProduct: 'nouveau',
    confirmStock: 'Valider et mettre à jour le stock',
    lowConfidence: 'Lecture incertaine — relis chaque ligne attentivement',
  },
  suggestions: {
    title: "Suggestions d'achat",
    buyMore: 'À commander',
    deadStock: 'Stock dormant',
    expiryRisk: 'Risque de péremption',
    priceIssues: 'Problèmes de marge',
    suggestedQty: 'Quantité suggérée',
    coverage: 'Couverture',
    sendOrder: 'Envoyer la commande',
    empty: 'Pas assez d’historique de ventes pour conseiller. Encaisse quelques ventes.',
  },
  assistant: {
    title: 'Assistant',
    placeholder: 'Quel est mon médicament le plus rentable ce mois-ci ?',
    disabled: 'Assistant indisponible : clé API Anthropic non configurée.',
  },
  settings: {
    title: 'Paramètres',
    pharmacy: 'Pharmacie',
    branches: 'Succursales',
    users: 'Utilisateurs',
    alerts: 'Alertes WhatsApp',
    whatsappNumber: 'Numéro WhatsApp des alertes',
    sendHour: 'Heure d’envoi',
    expiryThresholds: 'Paliers de péremption (jours)',
    importCatalog: 'Importer un catalogue Excel',
  },
};

/**
 * Le type vient du dictionnaire français (pas de `as const` : les traductions
 * doivent pouvoir remplacer une valeur par une autre chaîne).
 */
export type Dictionary = typeof fr;

/** Traduction partielle acceptée : les clés manquantes retombent sur le FR. */
type PartialDictionary = {
  [K in keyof Dictionary]?: Partial<Dictionary[K]>;
};

export const so: PartialDictionary = {
  common: {
    search: 'Raadi',
    save: 'Kaydi',
    cancel: 'Jooji',
    confirm: 'Xaqiiji',
    loading: 'Waa la soo dejinayaa…',
    empty: 'Xog ma jirto',
    error: 'Khalad ayaa dhacay',
    quantity: 'Tirada',
    price: 'Qiimaha',
    total: 'Wadarta',
    today: 'Maanta',
    days: 'maalmood',
    logout: 'Ka bax',
  },
  nav: {
    dashboard: 'Shaxda',
    pos: 'Kaashka',
    products: 'Alaabta',
    stock: 'Bakhaarka',
    purchases: 'Iibsiga',
    sales: 'Iibka',
    customers: 'Macaamiisha',
    suggestions: 'Talooyin',
    assistant: 'Caawiye',
    settings: 'Dejinta',
  },
  pos: {
    title: 'Kaashka',
    cart: 'Gaadhiga',
    checkout: 'Iibi',
    paymentMethod: 'Habka lacag bixinta',
    change: 'Lacagta laga celiyo',
  },
};

export const ar: PartialDictionary = {
  common: {
    search: 'بحث',
    save: 'حفظ',
    cancel: 'إلغاء',
    confirm: 'تأكيد',
    loading: 'جارٍ التحميل…',
    empty: 'لا توجد بيانات',
    error: 'حدث خطأ',
    quantity: 'الكمية',
    price: 'السعر',
    total: 'المجموع',
    today: 'اليوم',
    days: 'أيام',
    logout: 'تسجيل الخروج',
  },
  nav: {
    dashboard: 'لوحة التحكم',
    pos: 'الصندوق',
    products: 'المنتجات',
    stock: 'المخزون',
    purchases: 'المشتريات',
    sales: 'المبيعات',
    customers: 'العملاء',
    suggestions: 'الاقتراحات',
    assistant: 'المساعد',
    settings: 'الإعدادات',
  },
  pos: {
    title: 'الصندوق',
    cart: 'السلة',
    checkout: 'تحصيل',
    paymentMethod: 'طريقة الدفع',
    change: 'الباقي',
  },
};

export const en: PartialDictionary = {
  common: {
    search: 'Search',
    save: 'Save',
    cancel: 'Cancel',
    confirm: 'Confirm',
    loading: 'Loading…',
    empty: 'No data',
    error: 'Something went wrong',
    quantity: 'Quantity',
    price: 'Price',
    total: 'Total',
    today: 'Today',
    days: 'days',
    logout: 'Sign out',
  },
  nav: {
    dashboard: 'Dashboard',
    pos: 'Register',
    products: 'Products',
    stock: 'Stock',
    purchases: 'Purchases',
    sales: 'Sales',
    customers: 'Customers',
    suggestions: 'Suggestions',
    assistant: 'Assistant',
    settings: 'Settings',
  },
  pos: {
    title: 'Register',
    cart: 'Cart',
    checkout: 'Charge',
    paymentMethod: 'Payment method',
    change: 'Change due',
  },
};

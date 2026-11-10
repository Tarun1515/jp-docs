/*
  GENERATOR FOR THE REST OF INDIA'S GEOGRAPHY SEED.

  ----------------------------------------------------------------------------
  🔴 WHY A GENERATOR AND NOT A HAND-TYPED SQL FILE
  ----------------------------------------------------------------------------
  Every id in these seeds is EXPLICIT and namespaced off the state's id —
  districts are StateId*100 + n, towns are StateId*10000 + n — because jp_app
  stores these ids with no foreign key (2.2). A fresh build that assigned
  different numbers from the ones a live jp_app points at would silently
  repoint every stored address.

  Haryana's 23 districts could be typed by hand and checked by eye. Seven
  hundred and eighty cannot: one transposed digit is a district that belongs to
  the wrong state and nothing would be red. So the ids and the codes are
  COMPUTED here, from the state id and the name, exactly as 012 computed its
  own, and this file is the only place the arithmetic appears.

  ----------------------------------------------------------------------------
  ⚠️ WHAT IS SEEDED, AND WHAT IS DELIBERATELY NOT
  ----------------------------------------------------------------------------
  DISTRICTS for every state and union territory, and ONE TOWN per district —
  its headquarters. That is what makes the address form usable everywhere: a
  school picks its state, then its district, then the town.

  TEHSILS ARE NOT SEEDED outside Haryana, and that is a decision rather than an
  omission. India has roughly six thousand of them, their names and boundaries
  change often, and no list we can cite today is both complete and current.
  Seeding a half-remembered one would put wrong names in front of the client
  under the appearance of authority. The form already handles their absence —
  `hasTehsils()` hides the control when a state has none, so a state without
  tehsils degrades to state → district → town with nothing broken and nothing
  empty on screen.

  ----------------------------------------------------------------------------
  🔴 NAMES ARE PROVISIONAL AND THE CLIENT OWNS THEM
  ----------------------------------------------------------------------------
  District lists move: Rajasthan was reorganised in 2023 and again in 2024,
  Ladakh went from two districts to seven, Assam and Nagaland have both merged
  and split units recently. The counts here are what we believe today.

  ⚠️ THAT IS EXACTLY WHY THE MERGE HAS NO `WHEN MATCHED THEN UPDATE`. Once a
  row is live its Name belongs to the client (2.47); if they correct a name, a
  re-run of the seed must not quietly undo the correction. A wrong name is a
  one-field edit in the admin screen. A name that silently reverts every deploy
  is a bug nobody can find.

  Run:  node scripts/gen-geography.mjs
  Then: review the three SQL files, run them, and add them to run_all.sql.
*/
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'D:/Projects/jp-backend/database/jp_mdm/03_seed';

/*
  State ids are READ FROM THE DATABASE's own seed order and asserted at the top
  of each generated file. They are not guessed here: 003_seed_geography.sql
  owns them, and if it ever changes, the generated guard refuses rather than
  seeding one state's districts into another state's number range.
*/
const STATES = {
  AP: { id: 1,  name: 'Andhra Pradesh' },
  AR: { id: 2,  name: 'Arunachal Pradesh' },
  AS: { id: 3,  name: 'Assam' },
  BR: { id: 4,  name: 'Bihar' },
  CG: { id: 5,  name: 'Chhattisgarh' },
  GA: { id: 6,  name: 'Goa' },
  GJ: { id: 7,  name: 'Gujarat' },
  HP: { id: 9,  name: 'Himachal Pradesh' },
  JH: { id: 10, name: 'Jharkhand' },
  KA: { id: 11, name: 'Karnataka' },
  KL: { id: 12, name: 'Kerala' },
  MP: { id: 13, name: 'Madhya Pradesh' },
  MH: { id: 14, name: 'Maharashtra' },
  MN: { id: 15, name: 'Manipur' },
  ML: { id: 16, name: 'Meghalaya' },
  MZ: { id: 17, name: 'Mizoram' },
  NL: { id: 18, name: 'Nagaland' },
  OD: { id: 19, name: 'Odisha' },
  PB: { id: 20, name: 'Punjab' },
  RJ: { id: 21, name: 'Rajasthan' },
  SK: { id: 22, name: 'Sikkim' },
  TN: { id: 23, name: 'Tamil Nadu' },
  TS: { id: 24, name: 'Telangana' },
  TR: { id: 25, name: 'Tripura' },
  UP: { id: 26, name: 'Uttar Pradesh' },
  UK: { id: 27, name: 'Uttarakhand' },
  WB: { id: 28, name: 'West Bengal' },
  AN: { id: 29, name: 'Andaman and Nicobar Islands' },
  CH: { id: 30, name: 'Chandigarh' },
  DH: { id: 31, name: 'Dadra and Nagar Haveli and Daman and Diu' },
  DL: { id: 32, name: 'Delhi' },
  JK: { id: 33, name: 'Jammu and Kashmir' },
  LA: { id: 34, name: 'Ladakh' },
  LD: { id: 35, name: 'Lakshadweep' },
  PY: { id: 36, name: 'Puducherry' },
};

/*
  The district lists.

  ⚠️ Each district's HEADQUARTERS TOWN is seeded with the district's own name
  unless it differs, in which case it is written as [district, headquarters].
  Most Indian districts are named after their headquarters, so the pair form is
  the exception and is used only where it is actually true.
*/
const DISTRICTS = {
  AP: ['Srikakulam', 'Vizianagaram', 'Parvathipuram Manyam', 'Alluri Sitharama Raju',
    ['Visakhapatnam', 'Visakhapatnam'], 'Anakapalli', 'Kakinada', 'East Godavari',
    ['Konaseema', 'Amalapuram'], 'West Godavari', ['Eluru', 'Eluru'], 'Krishna',
    ['NTR', 'Vijayawada'], 'Guntur', 'Palnadu', 'Bapatla', 'Prakasam',
    ['Sri Potti Sriramulu Nellore', 'Nellore'], 'Kurnool', 'Nandyal', 'Anantapur',
    'Sri Sathya Sai', 'YSR Kadapa', 'Annamayya', 'Chittoor', 'Tirupati'],

  AR: ['Tawang', 'West Kameng', 'East Kameng', 'Pakke-Kessang', 'Papum Pare',
    'Kurung Kumey', 'Kra Daadi', 'Lower Subansiri', 'Upper Subansiri', 'Keyi Panyor',
    'West Siang', 'Shi Yomi', 'Lepa Rada', 'Lower Siang', 'East Siang', 'Siang',
    'Upper Siang', 'Dibang Valley', 'Lower Dibang Valley', 'Anjaw', 'Lohit',
    'Namsai', 'Changlang', 'Tirap', 'Longding'],

  AS: ['Baksa', 'Barpeta', 'Biswanath', 'Bongaigaon', 'Cachar', 'Charaideo',
    'Chirang', 'Darrang', 'Dhemaji', 'Dhubri', 'Dibrugarh', 'Dima Hasao',
    'Goalpara', 'Golaghat', 'Hailakandi', 'Hojai', 'Jorhat', 'Kamrup',
    'Kamrup Metropolitan', 'Karbi Anglong', 'Karimganj', 'Kokrajhar', 'Lakhimpur',
    'Majuli', 'Morigaon', 'Nagaon', 'Nalbari', 'Sivasagar', 'Sonitpur',
    'South Salmara-Mankachar', 'Tinsukia', 'Udalguri', 'West Karbi Anglong',
    'Bajali', 'Tamulpur'],

  BR: ['Araria', 'Arwal', 'Aurangabad', 'Banka', 'Begusarai', 'Bhagalpur',
    'Bhojpur', 'Buxar', 'Darbhanga', 'East Champaran', 'Gaya', 'Gopalganj',
    'Jamui', 'Jehanabad', 'Kaimur', 'Katihar', 'Khagaria', 'Kishanganj',
    'Lakhisarai', 'Madhepura', 'Madhubani', 'Munger', 'Muzaffarpur', 'Nalanda',
    'Nawada', 'Patna', 'Purnia', 'Rohtas', 'Saharsa', 'Samastipur', 'Saran',
    'Sheikhpura', 'Sheohar', 'Sitamarhi', 'Siwan', 'Supaul', 'Vaishali',
    'West Champaran'],

  CG: ['Balod', 'Baloda Bazar', 'Balrampur', 'Bastar', 'Bemetara', 'Bijapur',
    'Bilaspur', 'Dantewada', 'Dhamtari', 'Durg', 'Gariaband', 'Gaurela-Pendra-Marwahi',
    'Janjgir-Champa', 'Jashpur', 'Kabirdham', 'Kanker', 'Kondagaon', 'Korba',
    'Koriya', 'Mahasamund', 'Manendragarh-Chirmiri-Bharatpur', 'Mohla-Manpur-Ambagarh Chowki',
    'Mungeli', 'Narayanpur', 'Raigarh', 'Raipur', 'Rajnandgaon', 'Sakti',
    'Sarangarh-Bilaigarh', 'Sukma', 'Surajpur', 'Surguja', 'Khairagarh-Chhuikhadan-Gandai'],

  GA: ['North Goa', 'South Goa'],

  GJ: ['Ahmedabad', 'Amreli', 'Anand', 'Aravalli', 'Banaskantha', 'Bharuch',
    'Bhavnagar', 'Botad', 'Chhota Udaipur', 'Dahod', 'Dang', 'Devbhoomi Dwarka',
    'Gandhinagar', 'Gir Somnath', 'Jamnagar', 'Junagadh', 'Kheda', 'Kutch',
    'Mahisagar', 'Mehsana', 'Morbi', 'Narmada', 'Navsari', 'Panchmahal', 'Patan',
    'Porbandar', 'Rajkot', 'Sabarkantha', 'Surat', 'Surendranagar', 'Tapi',
    'Vadodara', 'Valsad'],

  HP: ['Bilaspur', 'Chamba', 'Hamirpur', 'Kangra', 'Kinnaur', 'Kullu',
    'Lahaul and Spiti', 'Mandi', 'Shimla', 'Sirmaur', 'Solan', 'Una'],

  JH: ['Bokaro', 'Chatra', 'Deoghar', 'Dhanbad', 'Dumka', 'East Singhbhum',
    'Garhwa', 'Giridih', 'Godda', 'Gumla', 'Hazaribagh', 'Jamtara', 'Khunti',
    'Koderma', 'Latehar', 'Lohardaga', 'Pakur', 'Palamu', 'Ramgarh', 'Ranchi',
    'Sahebganj', 'Seraikela Kharsawan', 'Simdega', 'West Singhbhum'],

  KA: ['Bagalkot', 'Ballari', 'Belagavi', 'Bengaluru Rural', 'Bengaluru Urban',
    'Bidar', 'Chamarajanagar', 'Chikkaballapur', 'Chikkamagaluru', 'Chitradurga',
    'Dakshina Kannada', 'Davanagere', 'Dharwad', 'Gadag', 'Hassan', 'Haveri',
    'Kalaburagi', 'Kodagu', 'Kolar', 'Koppal', 'Mandya', 'Mysuru', 'Raichur',
    'Ramanagara', 'Shivamogga', 'Tumakuru', 'Udupi', 'Uttara Kannada',
    'Vijayanagara', 'Vijayapura', 'Yadgir'],

  KL: ['Alappuzha', 'Ernakulam', 'Idukki', 'Kannur', 'Kasaragod', 'Kollam',
    'Kottayam', 'Kozhikode', 'Malappuram', 'Palakkad', 'Pathanamthitta',
    'Thiruvananthapuram', 'Thrissur', 'Wayanad'],

  MP: ['Agar Malwa', 'Alirajpur', 'Anuppur', 'Ashoknagar', 'Balaghat', 'Barwani',
    'Betul', 'Bhind', 'Bhopal', 'Burhanpur', 'Chhatarpur', 'Chhindwara', 'Damoh',
    'Datia', 'Dewas', 'Dhar', 'Dindori', 'Guna', 'Gwalior', 'Harda', 'Indore',
    'Jabalpur', 'Jhabua', 'Katni', 'Khandwa', 'Khargone', 'Mandla', 'Mandsaur',
    'Morena', 'Narmadapuram', 'Narsinghpur', 'Neemuch', 'Niwari', 'Panna',
    'Raisen', 'Rajgarh', 'Ratlam', 'Rewa', 'Sagar', 'Satna', 'Sehore', 'Seoni',
    'Shahdol', 'Shajapur', 'Sheopur', 'Shivpuri', 'Sidhi', 'Singrauli', 'Tikamgarh',
    'Ujjain', 'Umaria', 'Vidisha', 'Maihar', 'Pandhurna', 'Mauganj'],

  MH: ['Ahmednagar', 'Akola', 'Amravati', 'Beed', 'Bhandara', 'Buldhana',
    'Chandrapur', 'Chhatrapati Sambhajinagar', 'Dhule', 'Gadchiroli', 'Gondia',
    'Hingoli', 'Jalgaon', 'Jalna', 'Kolhapur', 'Latur', ['Mumbai City', 'Mumbai'],
    ['Mumbai Suburban', 'Bandra'], 'Nagpur', 'Nanded', 'Nandurbar', 'Nashik',
    'Osmanabad', 'Palghar', 'Parbhani', 'Pune', 'Raigad', 'Ratnagiri', 'Sangli',
    'Satara', 'Sindhudurg', 'Solapur', 'Thane', 'Wardha', 'Washim', 'Yavatmal'],

  MN: ['Bishnupur', 'Chandel', 'Churachandpur', 'Imphal East', 'Imphal West',
    'Jiribam', 'Kakching', 'Kamjong', 'Kangpokpi', 'Noney', 'Pherzawl',
    'Senapati', 'Tamenglong', 'Tengnoupal', 'Thoubal', 'Ukhrul'],

  ML: ['East Garo Hills', 'East Jaintia Hills', 'East Khasi Hills',
    'Eastern West Khasi Hills', 'North Garo Hills', 'Ri Bhoi', 'South Garo Hills',
    'South West Garo Hills', 'South West Khasi Hills', 'West Garo Hills',
    'West Jaintia Hills', 'West Khasi Hills'],

  MZ: ['Aizawl', 'Champhai', 'Hnahthial', 'Khawzawl', 'Kolasib', 'Lawngtlai',
    'Lunglei', 'Mamit', 'Saiha', 'Saitual', 'Serchhip'],

  NL: ['Chumoukedima', 'Dimapur', 'Kiphire', 'Kohima', 'Longleng', 'Mokokchung',
    'Mon', 'Niuland', 'Noklak', 'Peren', 'Phek', 'Shamator', 'Tseminyu',
    'Tuensang', 'Wokha', 'Zunheboto'],

  OD: ['Angul', 'Balangir', 'Balasore', 'Bargarh', 'Bhadrak', 'Boudh', 'Cuttack',
    'Deogarh', 'Dhenkanal', 'Gajapati', 'Ganjam', 'Jagatsinghpur', 'Jajpur',
    'Jharsuguda', 'Kalahandi', 'Kandhamal', 'Kendrapara', 'Kendujhar', 'Khordha',
    'Koraput', 'Malkangiri', 'Mayurbhanj', 'Nabarangpur', 'Nayagarh', 'Nuapada',
    'Puri', 'Rayagada', 'Sambalpur', 'Subarnapur', 'Sundargarh'],

  PB: ['Amritsar', 'Barnala', 'Bathinda', 'Faridkot', 'Fatehgarh Sahib', 'Fazilka',
    'Ferozepur', 'Gurdaspur', 'Hoshiarpur', 'Jalandhar', 'Kapurthala', 'Ludhiana',
    'Malerkotla', 'Mansa', 'Moga', 'Pathankot', 'Patiala', 'Rupnagar',
    ['Sahibzada Ajit Singh Nagar', 'Mohali'], 'Sangrur',
    ['Shahid Bhagat Singh Nagar', 'Nawanshahr'], 'Sri Muktsar Sahib', 'Tarn Taran'],

  RJ: ['Ajmer', 'Alwar', 'Banswara', 'Baran', 'Barmer', 'Bharatpur', 'Bhilwara',
    'Bikaner', 'Bundi', 'Chittorgarh', 'Churu', 'Dausa', 'Dholpur', 'Dungarpur',
    'Hanumangarh', 'Jaipur', 'Jaisalmer', 'Jalore', 'Jhalawar', 'Jhunjhunu',
    'Jodhpur', 'Karauli', 'Kota', 'Nagaur', 'Pali', 'Pratapgarh', 'Rajsamand',
    'Sawai Madhopur', 'Sikar', 'Sirohi', 'Sri Ganganagar', 'Tonk', 'Udaipur',
    'Balotra', 'Beawar', 'Deeg', 'Didwana-Kuchaman', 'Kotputli-Behror',
    'Khairthal-Tijara', 'Phalodi', 'Salumbar'],

  SK: ['Gangtok', 'Gyalshing', 'Mangan', 'Namchi', 'Pakyong', 'Soreng'],

  TN: ['Ariyalur', 'Chengalpattu', 'Chennai', 'Coimbatore', 'Cuddalore',
    'Dharmapuri', 'Dindigul', 'Erode', 'Kallakurichi', 'Kanchipuram',
    'Kanyakumari', 'Karur', 'Krishnagiri', 'Madurai', 'Mayiladuthurai',
    'Nagapattinam', 'Namakkal', 'Nilgiris', 'Perambalur', 'Pudukkottai',
    'Ramanathapuram', 'Ranipet', 'Salem', 'Sivaganga', 'Tenkasi', 'Thanjavur',
    'Theni', 'Thoothukudi', 'Tiruchirappalli', 'Tirunelveli', 'Tirupathur',
    'Tiruppur', 'Tiruvallur', 'Tiruvannamalai', 'Tiruvarur', 'Vellore',
    'Viluppuram', 'Virudhunagar'],

  TS: ['Adilabad', 'Bhadradri Kothagudem', 'Hanamkonda', 'Hyderabad',
    'Jagtial', 'Jangaon', 'Jayashankar Bhupalpally', 'Jogulamba Gadwal',
    'Kamareddy', 'Karimnagar', 'Khammam', 'Komaram Bheem Asifabad', 'Mahabubabad',
    'Mahabubnagar', 'Mancherial', 'Medak', 'Medchal-Malkajgiri', 'Mulugu',
    'Nagarkurnool', 'Nalgonda', 'Narayanpet', 'Nirmal', 'Nizamabad', 'Peddapalli',
    'Rajanna Sircilla', 'Rangareddy', 'Sangareddy', 'Siddipet', 'Suryapet',
    'Vikarabad', 'Wanaparthy', 'Warangal', 'Yadadri Bhuvanagiri'],

  TR: ['Dhalai', 'Gomati', 'Khowai', 'North Tripura', 'Sepahijala',
    'South Tripura', 'Unakoti', 'West Tripura'],

  UP: ['Agra', 'Aligarh', 'Ambedkar Nagar', 'Amethi', 'Amroha', 'Auraiya',
    'Ayodhya', 'Azamgarh', 'Baghpat', 'Bahraich', 'Ballia', 'Balrampur', 'Banda',
    'Barabanki', 'Bareilly', 'Basti', 'Bhadohi', 'Bijnor', 'Budaun',
    'Bulandshahr', 'Chandauli', 'Chitrakoot', 'Deoria', 'Etah', 'Etawah',
    'Farrukhabad', 'Fatehpur', 'Firozabad', ['Gautam Buddha Nagar', 'Noida'],
    'Ghaziabad', 'Ghazipur', 'Gonda', 'Gorakhpur', 'Hamirpur', 'Hapur', 'Hardoi',
    'Hathras', 'Jalaun', 'Jaunpur', 'Jhansi', 'Kannauj', 'Kanpur Dehat',
    'Kanpur Nagar', 'Kasganj', 'Kaushambi', 'Kheri', 'Kushinagar', 'Lalitpur',
    'Lucknow', 'Maharajganj', 'Mahoba', 'Mainpuri', 'Mathura', 'Mau', 'Meerut',
    'Mirzapur', 'Moradabad', 'Muzaffarnagar', 'Pilibhit', 'Pratapgarh',
    'Prayagraj', 'Raebareli', 'Rampur', 'Saharanpur', 'Sambhal', 'Sant Kabir Nagar',
    'Shahjahanpur', 'Shamli', 'Shravasti', 'Siddharthnagar', 'Sitapur', 'Sonbhadra',
    'Sultanpur', 'Unnao', 'Varanasi'],

  UK: ['Almora', 'Bageshwar', 'Chamoli', 'Champawat', 'Dehradun', 'Haridwar',
    'Nainital', 'Pauri Garhwal', 'Pithoragarh', 'Rudraprayag', 'Tehri Garhwal',
    'Udham Singh Nagar', 'Uttarkashi'],

  WB: ['Alipurduar', 'Bankura', 'Birbhum', 'Cooch Behar', 'Dakshin Dinajpur',
    'Darjeeling', 'Hooghly', 'Howrah', 'Jalpaiguri', 'Jhargram', 'Kalimpong',
    'Kolkata', 'Malda', 'Murshidabad', 'Nadia', 'North 24 Parganas',
    'Paschim Bardhaman', 'Paschim Medinipur', 'Purba Bardhaman', 'Purba Medinipur',
    'Purulia', 'South 24 Parganas', 'Uttar Dinajpur'],

  AN: ['Nicobar', 'North and Middle Andaman', 'South Andaman'],
  CH: [['Chandigarh', 'Chandigarh']],
  DH: ['Dadra and Nagar Haveli', 'Daman', 'Diu'],
  DL: ['Central Delhi', 'East Delhi', 'New Delhi', 'North Delhi', 'North East Delhi',
    'North West Delhi', 'Shahdara', 'South Delhi', 'South East Delhi',
    'South West Delhi', 'West Delhi'],
  JK: ['Anantnag', 'Bandipora', 'Baramulla', 'Budgam', 'Doda', 'Ganderbal',
    'Jammu', 'Kathua', 'Kishtwar', 'Kulgam', 'Kupwara', 'Poonch', 'Pulwama',
    'Rajouri', 'Ramban', 'Reasi', 'Samba', 'Shopian', 'Srinagar', 'Udhampur'],
  LA: ['Kargil', 'Leh', 'Nubra', 'Changthang', 'Sham', 'Zanskar', 'Drass'],
  LD: [['Lakshadweep', 'Kavaratti']],
  PY: ['Karaikal', 'Mahe', 'Puducherry', 'Yanam'],
};

/*
  States whose district list is genuinely in motion. Named in the generated
  header so the client is told WHICH numbers to re-check rather than being
  handed a list that looks equally settled throughout.
*/
const VOLATILE = {
  RJ: 'reorganised in 2023 and revised again in 2024 — the newest districts are the ones to confirm',
  LA: 'expanded from two districts to seven in 2024',
  NL: 'several districts created since 2021',
  AS: 'units merged and split since 2022',
  CG: 'three districts created in 2022',
  MP: 'three districts created in 2023',
};

// ---------------------------------------------------------------------------

/** One name part: ASCII, uppercase, everything else removed. HISAR, NARNAUND. */
const part = (name) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/[^A-Z0-9]+/g, '');

/** HR_HISAR \u2014 a district code. */
const codeOf = (stateCode, name) => `${stateCode}_${part(name)}`;

/*
  HR_HISAR_NARNAUND \u2014 a town code, 012's convention: state, district, town.

  \ud83d\udd34 THE SEPARATOR HAS TO BE ADDED HERE, NOT INSIDE THE NAME. The first version
  built this as codeOf(state, `${district}_${town}`), and `part()` strips every
  non-alphanumeric \u2014 including that underscore. The two names ran together, and
  where a district's headquarters shares its name (most of them do) the result
  was the name written TWICE: CG_MANENDRAGARHCHIRMIRIBHARATPURMANENDRAGARHCHIRMIRIBHARATPUR,
  sixty-one characters, which is what broke the insert.

  \u26a0\ufe0f AND WHERE THE TOWN IS THE DISTRICT, THE NAME APPEARS ONCE. CG_RAIPUR, not
  CG_RAIPUR_RAIPUR. A district code and a town code live in different tables
  with separate unique constraints, so they cannot collide \u2014 and a code nobody
  can read is a worse identifier than a short one.
*/
const cityCodeOf = (stateCode, district, town) =>
  part(district) === part(town)
    ? `${stateCode}_${part(district)}`
    : `${stateCode}_${part(district)}_${part(town)}`;

/** A district entry is either 'Name' or ['Name', 'HeadquartersTown']. */
const split = (entry) => (Array.isArray(entry) ? entry : [entry, entry]);

const esc = (s) => s.replace(/'/g, "''");

const fileFor = (seq, title, codes) => {
  const lines = [];
  const p = (s = '') => lines.push(s);

  const totalD = codes.reduce((n, c) => n + DISTRICTS[c].length, 0);

  p('/*==============================================================================');
  p(`  ${title} — districts and their headquarters towns.`);
  p('');
  p('  ---------------------------------------------------------------------------');
  p('  🔴 GENERATED. Do not hand-edit — change scripts/gen-geography.mjs in jp-docs');
  p('  and regenerate, or the next regeneration silently reverts the edit.');
  p('  ---------------------------------------------------------------------------');
  p('');
  p('  Ids are EXPLICIT and namespaced off the state id, exactly as 012 does:');
  p('');
  p('      district   StateId * 100   + n');
  p('      town       StateId * 10000 + n');
  p('');
  p('  jp_app stores these ids with NO foreign key (2.2). If a fresh build ever');
  p('  assigned different numbers from the ones a live jp_app points at, every');
  p('  stored address would quietly point somewhere else — so each file asserts');
  p("  its states' ids before writing a single row.");
  p('');
  p('  ---------------------------------------------------------------------------');
  p('  ⚠️ TEHSILS ARE NOT SEEDED HERE, AND THAT IS DELIBERATE');
  p('  ---------------------------------------------------------------------------');
  p('  Only Haryana has tehsils (012), from a named source read on a stated date.');
  p('  India has roughly six thousand, they change often, and no list we can cite');
  p('  today is both complete and current. A half-remembered one would put wrong');
  p('  names in front of the client wearing the authority of a master table.');
  p('');
  p('  The form already handles their absence: hasTehsils() hides the control for');
  p('  a state with none, so the address degrades to state → district → town with');
  p('  nothing broken and nothing empty on screen.');
  p('');
  p('  ---------------------------------------------------------------------------');
  p('  🔴 NAMES ARE PROVISIONAL AND BELONG TO THE CLIENT (2.47)');
  p('  ---------------------------------------------------------------------------');
  p('  The MERGE has NO `WHEN MATCHED THEN UPDATE`. Once a row is live its Name is');
  p('  the client\'s; if they correct one, a re-run must not undo the correction.');
  p('');
  const vol = codes.filter((c) => VOLATILE[c]);
  if (vol.length) {
    p('  ⚠️ IN THIS FILE, THESE LISTS ARE KNOWN TO BE IN MOTION:');
    for (const c of vol) p(`      ${STATES[c].name} — ${VOLATILE[c]}`);
    p('');
  }
  p('  ---------------------------------------------------------------------------');
  p(`  CONTENTS: ${codes.length} states/UTs, ${totalD} districts, ${totalD} towns`);
  p('  (one town per district: its headquarters).');
  p('');
  p('  IDEMPOTENT. Every row is guarded on Code, so re-running changes nothing.');
  p('==============================================================================*/');
  p('');
  p('USE jp_mdm;');
  p('GO');
  p('');
  p('SET QUOTED_IDENTIFIER ON;');
  p('SET ANSI_NULLS ON;');
  p('GO');
  p('');
  p(`PRINT '  Seeding geography — ${title} ...';`);
  p('GO');
  p('');

  for (const code of codes) {
    const st = STATES[code];
    const list = DISTRICTS[code];

    p('/*--------------------------------------------------------------------------');
    p(`  ${st.name} (${code}) — StateId ${st.id}, ${list.length} districts`);
    p('--------------------------------------------------------------------------*/');
    p(`DECLARE @StateId_${code} int = (SELECT StateId FROM dbo.m_mdm_state WHERE Code = '${code}' AND Is_Deleted = 0);`);
    p('');
    p(`IF @StateId_${code} IS NULL`);
    p(`    THROW 50001, '${seq}: the state ${code} is not seeded. 003_seed_geography.sql must run first.', 1;`);
    p('');
    p(`IF @StateId_${code} <> ${st.id}`);
    p('BEGIN');
    p('    /*');
    p('      🔴 THE ID NAMESPACE IS DERIVED FROM THE STATE ID. If this state is not');
    p(`      ${st.id} on this machine, every id below belongs to another state's range.`);
    p('      Refusing beats seeding one state into another\'s numbers.');
    p('    */');
    p(`    DECLARE @wrong_${code} nvarchar(400) = N'${seq}: ${code} is StateId '`);
    /*
      ⚠️ `file''s` — DOUBLED, because this text is inside a T-SQL string. The
      first version wrote a single apostrophe, which closed the string early and
      left the rest of the line to be parsed as T-SQL: the leading digits of the
      file name then read as a label and the batch failed with "The label
      '_seed_geography_north' has already been declared". A generator that emits
      another language has to escape for that language, not this one.
    */
    p(`        + CAST(@StateId_${code} AS nvarchar(10)) + N' here, but this file''s ids are namespaced for StateId ${st.id}.';`);
    p('');
    p(`    RAISERROR('%s', 16, 1, @wrong_${code});`);
    p('END');
    p('');

    // districts
    p(`MERGE dbo.m_mdm_district AS tgt`);
    p('USING (VALUES');
    const dRows = list.map((entry, i) => {
      const [dName] = split(entry);
      return `    (${st.id * 100 + i + 1}, '${codeOf(code, dName)}', N'${esc(dName)}', ${(i + 1) * 10})`;
    });
    p(dRows.join(',\n'));
    p(`) AS src (DistrictId, Code, Name, DisplayOrder)`);
    p('    ON tgt.Code = src.Code');
    p('WHEN NOT MATCHED BY TARGET THEN');
    p('    INSERT (DistrictId, StateId, Code, Name, DisplayOrder, Is_Active, Is_Deleted, CreatedOn)');
    p(`    VALUES (src.DistrictId, @StateId_${code}, src.Code, src.Name, src.DisplayOrder, 1, 0, SYSUTCDATETIME());`);
    p('');

    // towns — one per district, its headquarters
    p(`MERGE dbo.m_mdm_city AS tgt`);
    p('USING (VALUES');
    const cRows = list.map((entry, i) => {
      const [dName, hq] = split(entry);
      return `    (${st.id * 10000 + i + 1}, ${st.id * 100 + i + 1}, '${cityCodeOf(code, dName, hq)}', N'${esc(hq)}', ${(i + 1) * 10})`;
    });
    p(cRows.join(',\n'));
    p(`) AS src (CityId, DistrictId, Code, Name, DisplayOrder)`);
    p('    ON tgt.Code = src.Code');
    p('WHEN NOT MATCHED BY TARGET THEN');
    p('    INSERT (CityId, DistrictId, Code, Name, DisplayOrder, Is_Active, Is_Deleted, CreatedOn)');
    p('    VALUES (src.CityId, src.DistrictId, src.Code, src.Name, src.DisplayOrder, 1, 0, SYSUTCDATETIME());');
    p('GO');
    p('');
  }

  // exit assertions
  p('/*==============================================================================');
  p('  EXIT ASSERTIONS — the counts this file promises');
  p('');
  p('  🔴 COUNTS ASSERTED, NOT PRINTED AND HOPED FOR. A seed that silently inserts');
  p('  most of its rows leaves a product where some districts do not exist and');
  p('  nothing is red.');
  p('==============================================================================*/');
  for (const code of codes) {
    const st = STATES[code];
    const n = DISTRICTS[code].length;
    p(`DECLARE @d_${code} int = (SELECT COUNT(*) FROM dbo.m_mdm_district d`);
    p(`    JOIN dbo.m_mdm_state s ON s.StateId = d.StateId`);
    p(`   WHERE s.Code = '${code}' AND d.Is_Deleted = 0);`);
    p(`IF @d_${code} <> ${n}`);
    p('BEGIN');
    p(`    DECLARE @m_${code} nvarchar(400) = N'${seq}: ${st.name} has ' + CAST(@d_${code} AS nvarchar(10))`);
    p(`        + N' districts, expected ${n}. If the source list genuinely changed, change the number in gen-geography.mjs in the same commit as the data.';`);
    p(`    RAISERROR('%s', 16, 1, @m_${code});`);
    p('END');
    p('');
  }
  p(`PRINT '    ${title} ready — ${totalD} districts, ${totalD} towns.';`);
  p('GO');

  return lines.join('\n') + '\n';
};

// ---------------------------------------------------------------------------

const BATCHES = [
  ['014_seed_geography_north', 'North India and the northern UTs',
    ['HP', 'PB', 'RJ', 'UP', 'UK', 'JK', 'LA', 'CH', 'DL']],
  ['015_seed_geography_east', 'East and North-East India',
    ['BR', 'JH', 'OD', 'WB', 'AS', 'AR', 'MN', 'ML', 'MZ', 'NL', 'SK', 'TR']],
  ['016_seed_geography_south_west', 'South and West India and the island UTs',
    ['GJ', 'MH', 'GA', 'MP', 'CG', 'AP', 'TS', 'KA', 'KL', 'TN', 'AN', 'DH', 'LD', 'PY']],
];

let grand = 0;
for (const [stem, title, codes] of BATCHES) {
  const sql = fileFor(stem, title, codes);
  fs.writeFileSync(path.join(OUT, `${stem}.sql`), sql, 'utf8');
  const n = codes.reduce((a, c) => a + DISTRICTS[c].length, 0);
  grand += n;
  console.log(`${stem}.sql  ${String(codes.length).padStart(2)} states  ${String(n).padStart(4)} districts`);
}

/* Every state except Haryana must appear exactly once. */
const covered = BATCHES.flatMap(([, , c]) => c);
const missing = Object.keys(STATES).filter((c) => !covered.includes(c));
const dupes = covered.filter((c, i) => covered.indexOf(c) !== i);

console.log(`\ntotal ${grand} districts across ${covered.length} states/UTs (Haryana's 23 are in 012)`);
if (missing.length) console.log(`🔴 MISSING from every batch: ${missing.join(', ')}`);
if (dupes.length) console.log(`🔴 DUPLICATED across batches: ${dupes.join(', ')}`);
if (missing.length || dupes.length) process.exit(1);
console.log('every state covered exactly once');

"""Pipeline configuration: paths, DB URL, constants."""

import os
import re
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
load_dotenv(PROJECT_ROOT / ".env.local")
load_dotenv(PROJECT_ROOT / ".env")

_raw_url = os.environ["DATABASE_URL"]
# psycopg2 does not support channel_binding — strip it
DATABASE_URL = re.sub(r"[&?]channel_binding=[^&]*", "", _raw_url)

EXCEL_PATH = os.environ.get(
    "INGEST_EXCEL_PATH",
    str(Path.home() / "dev/phantom/src/packages/phantom-canon/data/knowledge_base.xlsx"),
)

METADATA_SOURCE = "phantom_canon"

# Library column → location config
LOCATION_MAP: dict[str, dict] = {
    "Library_Physical_MEX": {"name": "Mexico City", "type": "physical", "format": "hardcover"},
    "Library_Physical_EUR": {"name": "Amsterdam", "type": "physical", "format": "hardcover"},
    "Library_Digital_Main": {"name": "Calibre", "type": "digital", "format": "epub"},
    "Library_Mobile_Kindle": {"name": "Kindle", "type": "digital", "format": "epub"},
    "Library_Mobile_iPad": {"name": "iPad", "type": "digital", "format": "epub"},
    "Library_Mobile_iPhone": {"name": "iPhone", "type": "digital", "format": "epub"},
}

# Roles that are purely non-literary (for People → authors filtering).
# A person who holds ONLY these roles is excluded. If they hold any other role, they're included.
NON_LITERARY_ROLES = frozenset({
    "Painter", "Sculptor", "Architect", "Composer", "Musician",
    "Singer", "Dancer", "Choreographer", "Film Director", "Actor",
    "Actress", "Photographer", "Cinematographer", "Fashion Designer",
    "Graphic Designer", "Industrial Designer", "Interior Designer",
    "Perfumer", "Ceramicist", "Textile Artist", "Jeweler",
    "Printmaker", "Engraver", "Calligrapher", "Weaver",
    "Glassblower", "Goldsmith", "Silversmith", "Woodworker",
    "Potter", "Muralist", "Stained Glass Artist", "Animator",
    "Colorist", "Set Designer", "Costume Designer", "Sound Designer",
    "Conductor", "Instrumentalist", "Opera Singer", "Ballet Dancer",
})

# Nationality adjective → country search term (for matching against countries table).
# Values should match the start of a country name in Countries_Continents.
NATIONALITY_TO_COUNTRY: dict[str, str] = {
    "Afghan": "Afghanistan", "Albanian": "Albania", "Algerian": "Algeria",
    "American": "United States", "Angolan": "Angola", "Argentine": "Argentina",
    "Argentinian": "Argentina", "Armenian": "Armenia", "Australian": "Australia",
    "Austrian": "Austria", "Azerbaijani": "Azerbaijan",
    "Bahraini": "Bahrain", "Bangladeshi": "Bangladesh", "Barbadian": "Barbados",
    "Belarusian": "Belarus", "Belgian": "Belgium", "Belizean": "Belize",
    "Bolivian": "Bolivia", "Bosnian": "Bosnia", "Brazilian": "Brazil",
    "British": "United Kingdom", "Bulgarian": "Bulgaria", "Burmese": "Myanmar",
    "Cambodian": "Cambodia", "Cameroonian": "Cameroon", "Canadian": "Canada",
    "Chilean": "Chile", "Chinese": "China", "Colombian": "Colombia",
    "Congolese": "Congo", "Costa Rican": "Costa Rica", "Croatian": "Croatia",
    "Cuban": "Cuba", "Cypriot": "Cyprus", "Czech": "Czech",
    "Danish": "Denmark", "Dominican": "Dominican", "Dutch": "Netherlands",
    "Ecuadorian": "Ecuador", "Egyptian": "Egypt", "Emirati": "United Arab Emirates",
    "English": "United Kingdom", "Eritrean": "Eritrea", "Estonian": "Estonia",
    "Ethiopian": "Ethiopia", "Filipino": "Philippines", "Finnish": "Finland",
    "Flemish": "Belgium", "French": "France",
    "Georgian": "Georgia", "German": "Germany", "Ghanaian": "Ghana",
    "Greek": "Greece", "Guatemalan": "Guatemala", "Guyanese": "Guyana",
    "Haitian": "Haiti", "Honduran": "Honduras", "Hungarian": "Hungary",
    "Icelandic": "Iceland", "Indian": "India", "Indonesian": "Indonesia",
    "Iranian": "Iran", "Iraqi": "Iraq", "Irish": "Ireland",
    "Israeli": "Israel", "Italian": "Italy",
    "Jamaican": "Jamaica", "Japanese": "Japan", "Jordanian": "Jordan",
    "Kazakh": "Kazakhstan", "Kenyan": "Kenya", "Korean": "Korea, Republic",
    "South Korean": "Korea, Republic", "Kuwaiti": "Kuwait", "Kyrgyz": "Kyrgyz",
    "Laotian": "Lao", "Latvian": "Latvia", "Lebanese": "Lebanon",
    "Libyan": "Libya", "Lithuanian": "Lithuania", "Luxembourgish": "Luxembourg",
    "Macedonian": "Macedonia", "Malaysian": "Malaysia", "Malian": "Mali",
    "Maltese": "Malta", "Mexican": "Mexico", "Moldovan": "Moldova",
    "Mongolian": "Mongolia", "Montenegrin": "Montenegro", "Moroccan": "Morocco",
    "Mozambican": "Mozambique", "Namibian": "Namibia", "Nepali": "Nepal",
    "New Zealander": "New Zealand", "Nicaraguan": "Nicaragua", "Nigerian": "Nigeria",
    "Norwegian": "Norway",
    "Omani": "Oman", "Pakistani": "Pakistan", "Palestinian": "Palestine",
    "Panamanian": "Panama", "Paraguayan": "Paraguay", "Peruvian": "Peru",
    "Polish": "Poland", "Portuguese": "Portugal", "Puerto Rican": "Puerto Rico",
    "Qatari": "Qatar", "Romanian": "Romania", "Russian": "Russian",
    "Rwandan": "Rwanda", "Saudi": "Saudi Arabia", "Scottish": "United Kingdom",
    "Senegalese": "Senegal", "Serbian": "Serbia", "Singaporean": "Singapore",
    "Slovak": "Slovak", "Slovenian": "Slovenia", "Somali": "Somalia",
    "South African": "South Africa", "Spanish": "Spain", "Sri Lankan": "Sri Lanka",
    "Sudanese": "Sudan", "Swedish": "Sweden", "Swiss": "Switzerland",
    "Syrian": "Syria", "Taiwanese": "Taiwan", "Tajik": "Tajikistan",
    "Tanzanian": "Tanzania", "Thai": "Thailand", "Trinidadian": "Trinidad",
    "Tunisian": "Tunisia", "Turkish": "Turkey", "Turkmen": "Turkmenistan",
    "Ugandan": "Uganda", "Ukrainian": "Ukraine", "Uruguayan": "Uruguay",
    "Uzbek": "Uzbekistan", "Venezuelan": "Venezuela", "Vietnamese": "Viet Nam",
    "Welsh": "United Kingdom", "Yemeni": "Yemen", "Zambian": "Zambia",
    "Zimbabwean": "Zimbabwe",
    # Ancient / historical
    "Ancient Egyptian": "Egypt", "Ancient Greek": "Greece", "Ancient Roman": "Italy",
    "Persian": "Iran", "Ottoman": "Turkey", "Babylonian": "Iraq",
    "Byzantine": "Greece", "Sumerian": "Iraq",
}

# Map specific role terms to contribution_types names.
# People.Type has specific terms like "Novelist" that should map to generic "Author".
ROLE_NORMALIZATION: dict[str, str] = {
    "Novelist": "Author", "Writer": "Author", "Poet": "Author",
    "Essayist": "Author", "Memoirist": "Author", "Biographer": "Author",
    "Autobiographer": "Author", "Short Story Writer": "Author",
    "Journalist": "Author", "Columnist": "Author",
    "Satirist": "Author", "Humorist": "Author", "Pamphleteer": "Author",
    "Diarist": "Author", "Dramatist": "Playwright",
    "Dramaturg": "Playwright", "Dramaturge": "Playwright",
    "Librettist": "Playwright", "Lyricist": "Author",
    "Film Director": "Director", "Theatre Director": "Director",
    "Opera Director": "Director", "Stage Director": "Director",
    "Art Historian": "Theorist", "Literary Critic": "Theorist",
    "Literary Theorist": "Theorist", "Art Critic": "Theorist",
    "Critic": "Theorist", "Cultural Theorist": "Theorist",
    "Music Theorist": "Theorist", "Film Critic": "Theorist",
    "Art Theorist": "Theorist", "Philosopher": "Theorist",
    "Historian": "Author", "Scholar": "Author", "Academic": "Author",
    "Professor": "Author", "Theologian": "Author",
    "Science Fiction Writer": "Author", "Horror Writer": "Author",
    "Crime Fiction Writer": "Author", "Detective Fiction Writer": "Author",
    "Gothic Novelist": "Author", "Horror Fiction Author": "Author",
    "Thriller Writer": "Author", "Mystery Writer": "Author",
    "Graphic Novelist": "Author", "Comic Book Writer": "Author",
    "Game Writer": "Author", "Scriptwriter": "Screenwriter",
    "Singer-Songwriter": "Musician", "Singer-songwriter": "Musician",
    "Singer": "Musician", "Pianist": "Musician",
    "Organist": "Musician", "Harpsichordist": "Musician",
    "Graffiti Artist": "Painter", "Watercolorist": "Painter",
    "Cartoonist": "Illustrator", "Comic Artist": "Illustrator",
    "Comic Book Artist": "Illustrator", "Manga Artist": "Illustrator",
    "Occultist": "Author", "Mystic": "Author",
    "Encyclopedist": "Editor", "Lexicographer": "Editor",
    "Semiotician": "Theorist", "Linguist": "Author",
    "Anthropologist": "Author", "Sociologist": "Author",
    "Psychologist": "Author", "Psychiatrist": "Author",
    "Psychoanalyst": "Author", "Scientist": "Author",
    "Mathematician": "Author", "Physicist": "Author",
    "Naturalist": "Author", "Polymath": "Author",
    "Political Philosopher": "Theorist", "Political Theorist": "Theorist",
    "Educator": "Author", "Teacher": "Author",
}

// The people the site should never be missing, listed by English Wikipedia
// title. seed_curated.js resolves each title to a Wikidata id, so a typo shows
// up as a failed lookup instead of quietly inserting the wrong person.
//
// The point of this list is coverage that a sitelink ranking will never give
// you: every era, every part of the world, and the figures that matter in
// Vietnamese history rather than only the ones with many language editions.

module.exports = {
  Vietnam: [
    'Trưng Trắc', 'Bà Triệu', 'Lý Nam Đế', 'Ngô Quyền', 'Đinh Bộ Lĩnh',
    'Lê Đại Hành', 'Lý Thái Tổ', 'Lý Thường Kiệt', 'Trần Thái Tông',
    'Trần Hưng Đạo', 'Trần Nhân Tông', 'Hồ Quý Ly', 'Lê Lợi', 'Nguyễn Trãi',
    'Lê Thánh Tông', 'Mạc Đăng Dung', 'Nguyễn Hoàng', 'Quang Trung',
    'Nguyễn Nhạc', 'Gia Long', 'Minh Mạng', 'Nguyễn Du', 'Hồ Xuân Hương',
    'Tự Đức', 'Phan Đình Phùng', 'Hoàng Hoa Thám', 'Phan Bội Châu',
    'Phan Châu Trinh', 'Hàm Nghi', 'Ho Chi Minh', 'Võ Nguyên Giáp',
    'Bảo Đại', 'Ngo Dinh Diem', 'Trịnh Công Sơn', 'Nguyễn Đình Chiểu',
  ],

  EastAsia: [
    'Confucius', 'Laozi', 'Sun Tzu', 'Qin Shi Huang', 'Emperor Wu of Han',
    'Sima Qian', 'Cao Cao', 'Wu Zetian', 'Emperor Taizong of Tang', 'Li Bai',
    'Du Fu', 'Su Shi', 'Zhu Xi', 'Genghis Khan', 'Kublai Khan', 'Zheng He',
    'Hongwu Emperor', 'Wang Yangming', 'Kangxi Emperor', 'Qianlong Emperor',
    'Cixi', 'Sun Yat-sen', 'Lu Xun', 'Mao Zedong', 'Deng Xiaoping',
    'Prince Shōtoku', 'Murasaki Shikibu', 'Sei Shōnagon', 'Minamoto no Yoritomo',
    'Oda Nobunaga', 'Toyotomi Hideyoshi', 'Tokugawa Ieyasu', 'Matsuo Bashō',
    'Katsushika Hokusai', 'Emperor Meiji', 'Sejong the Great', 'Yi Sun-sin',
    'Wang Kon', 'Hong Xiuquan',
  ],

  SoutheastAsia: [
    'Jayavarman VII', 'Suryavarman II', 'Ramkhamhaeng', 'Naresuan',
    'Chulalongkorn', 'Mongkut', 'Bayinnaung', 'Anawrahta', 'Aung San',
    'Raden Wijaya', 'Gajah Mada', 'Hayam Wuruk', 'Sukarno', 'Lapulapu',
    'José Rizal', 'Andrés Bonifacio', 'Lee Kuan Yew', 'Norodom Sihanouk',
    'Hassanal Bolkiah', 'Diponegoro',
  ],

  SouthAsia: [
    'Gautama Buddha', 'Mahavira', 'Chanakya', 'Ashoka', 'Chandragupta Maurya',
    'Kalidasa', 'Aryabhata', 'Brahmagupta', 'Adi Shankara', 'Rajaraja I',
    'Basava', 'Kabir', 'Guru Nanak', 'Akbar', 'Shah Jahan', 'Aurangzeb',
    'Shivaji', 'Tipu Sultan', 'Rani of Jhansi', 'Ram Mohan Roy',
    'Ramakrishna', 'Swami Vivekananda', 'Rabindranath Tagore',
    'Mahatma Gandhi', 'B. R. Ambedkar', 'Jawaharlal Nehru',
    'Muhammad Ali Jinnah', 'Srinivasa Ramanujan', 'Amir Khusrau',
  ],

  MiddleEastAndPersia: [
    'Hammurabi', 'Cyrus the Great', 'Darius the Great', 'Xerxes I',
    'Zoroaster', 'Muhammad', 'Ali', 'Umar', 'Harun al-Rashid', 'Al-Khwarizmi',
    'Al-Ghazali', 'Ibn Sina', 'Averroes', 'Omar Khayyam', 'Rumi',
    'Saladin', 'Ibn Battuta', 'Ibn Khaldun', 'Hafez', 'Timur',
    'Mehmed the Conqueror', 'Suleiman the Magnificent', 'Mimar Sinan',
    'Abbas the Great', 'Nader Shah', 'Mustafa Kemal Atatürk',
    'Ruhollah Khomeini', 'Gilgamesh', 'Nebuchadnezzar II',
  ],

  Africa: [
    'Imhotep', 'Hatshepsut', 'Akhenaten', 'Tutankhamun', 'Ramesses II',
    'Piye', 'Hannibal', 'Augustine of Hippo', 'Ezana of Axum',
    'Mansa Musa', 'Sundiata Keita', 'Askia Mohammad I', 'Ahmad Baba al-Timbukti',
    'Idris Alooma', 'Queen Nzinga', 'Shaka', 'Menelik II', 'Yaa Asantewaa',
    'Samori Ture', 'Haile Selassie', 'Kwame Nkrumah', 'Patrice Lumumba',
    'Nelson Mandela', 'Wangari Maathai', 'Chinua Achebe', 'Taharqa',
    'Amina of Zaria', 'Behanzin',
  ],

  Americas: [
    'Pachacuti', 'Atahualpa', 'Moctezuma II', 'Nezahualcoyotl', 'Pacal the Great',
    'Tecumseh', 'Sitting Bull', 'Geronimo', 'Benito Juárez', 'Simón Bolívar',
    'José de San Martín', 'Toussaint Louverture', 'George Washington',
    'Thomas Jefferson', 'Benjamin Franklin', 'Abraham Lincoln',
    'Frederick Douglass', 'Harriet Tubman', 'Sojourner Truth',
    'Sor Juana Inés de la Cruz', 'José Martí', 'Emiliano Zapata',
    'Frida Kahlo', 'Diego Rivera', 'Martin Luther King Jr.', 'Rosa Parks',
    'Malcolm X', 'Che Guevara', 'Pablo Neruda', 'Jorge Luis Borges',
    'Gabriel García Márquez',
  ],

  EuropeAncient: [
    'Homer', 'Sappho', 'Solon', 'Pythagoras', 'Herodotus', 'Socrates',
    'Plato', 'Aristotle', 'Alexander the Great', 'Euclid', 'Archimedes',
    'Hippocrates', 'Sophocles', 'Pericles', 'Julius Caesar', 'Cicero',
    'Augustus', 'Virgil', 'Ovid', 'Seneca the Younger', 'Marcus Aurelius',
    'Ptolemy', 'Galen', 'Constantine the Great', 'Boudica', 'Cleopatra',
    'Justinian I', 'Theodora (wife of Justinian I)',
  ],

  EuropeMedievalAndModern: [
    'Charlemagne', 'Alfred the Great', 'William the Conqueror',
    'Hildegard of Bingen', 'Thomas Aquinas', 'Dante Alighieri', 'Giotto',
    'Geoffrey Chaucer', 'Joan of Arc', 'Johannes Gutenberg',
    'Leonardo da Vinci', 'Christopher Columbus', 'Nicolaus Copernicus',
    'Michelangelo', 'Martin Luther', 'Ferdinand Magellan', 'Elizabeth I',
    'William Shakespeare', 'Miguel de Cervantes', 'Galileo Galilei',
    'Johannes Kepler', 'René Descartes', 'Rembrandt', 'Isaac Newton',
    'Johann Sebastian Bach', 'Voltaire', 'Jean-Jacques Rousseau',
    'Adam Smith', 'Wolfgang Amadeus Mozart', 'Catherine the Great',
    'Maximilien Robespierre', 'Napoleon', 'Ludwig van Beethoven',
    'Mary Wollstonecraft', 'Jane Austen', 'Michael Faraday',
    'Charles Darwin', 'Ada Lovelace', 'Karl Marx', 'Charles Dickens',
    'Florence Nightingale', 'Leo Tolstoy', 'Fyodor Dostoevsky',
    'Louis Pasteur', 'Claude Monet', 'Vincent van Gogh', 'Marie Curie',
    'Sigmund Freud', 'Albert Einstein', 'Pablo Picasso', 'Virginia Woolf',
    'Alan Turing', 'Simone de Beauvoir', 'Rosalind Franklin',
    'Gregor Mendel', 'Dmitri Mendeleev', 'Nikola Tesla', 'Antoni Gaudí',
  ],

  Oceania: [
    'Kupe', 'Tāwhiao', 'Te Rauparaha', 'Hongi Hika', 'Truganini',
    'Kamehameha I', 'Liliʻuokalani', 'Ratu Seru Cakobau',
  ],
};

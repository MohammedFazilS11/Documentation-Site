/** ==========================================
 *  Database Wrapper using IndexedDB
 *  ========================================== */
const DB_NAME = 'ProgressTrackerDB';
const DB_VERSION = 1;
const STORE_NAME = 'entries';

class StorageDB {
    constructor() {
        this.db = null;
    }

    init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            
            request.onerror = (event) => reject('Database error: ' + event.target.error);
            
            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    store.createIndex('date', 'date', { unique: false });
                }
            };
        });
    }

    async saveEntry(entry) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.put(entry);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async deleteEntry(id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async getEntriesByDate(dateString) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const index = store.index('date');
            const request = index.getAll(dateString);
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getAllEntries() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.getAll();
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
}

const db = new StorageDB();

/** ==========================================
 *  State & Initialization
 *  ========================================== */
let currentDate = new Date();
let selectedDate = new Date();
let chartInstance = null;

// DOM Elements
const calendarDaysEl = document.getElementById('calendar-days');
const calendarMonthYearEl = document.getElementById('calendar-month-year');
const selectedDateDisplay = document.getElementById('selected-date-display');
const timelineFeed = document.getElementById('timeline-feed');
const entriesCountDisplay = document.getElementById('entries-count-display');

// Modal Elements
const modal = document.getElementById('entry-modal');
const entryForm = document.getElementById('entry-form');
const addEntryBtn = document.getElementById('add-entry-btn');
const closeBtns = document.querySelectorAll('.close-modal-btn');

document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    await db.init();
    
    renderCalendar(currentDate);
    await loadDashboardForDate(selectedDate);
    await updateGlobalStats();
    
    setupEventListeners();
});

/** ==========================================
 *  Calendar Logic
 *  ========================================== */
function renderCalendar(date) {
    calendarDaysEl.innerHTML = '';
    
    const year = date.getFullYear();
    const month = date.getMonth();
    
    calendarMonthYearEl.textContent = date.toLocaleDateString('default', { month: 'long', year: 'numeric' });
    
    const firstDayIndex = new Date(year, month, 1).getDay();
    const lastDayText = new Date(year, month + 1, 0).getDate();
    
    // Empty slots before first day
    for (let i = 0; i < firstDayIndex; i++) {
        const emptyDiv = document.createElement('div');
        emptyDiv.classList.add('calendar-day', 'empty');
        calendarDaysEl.appendChild(emptyDiv);
    }
    
    // Actual days
    for (let i = 1; i <= lastDayText; i++) {
        const dayDiv = document.createElement('div');
        dayDiv.classList.add('calendar-day');
        dayDiv.textContent = i;
        
        // Highlight active
        if (i === selectedDate.getDate() && month === selectedDate.getMonth() && year === selectedDate.getFullYear()) {
            dayDiv.classList.add('active');
        }
        
        // Setup click listener
        dayDiv.addEventListener('click', () => {
            selectedDate = new Date(year, month, i);
            renderCalendar(currentDate); // Re-render to update active styling
            loadDashboardForDate(selectedDate);
        });
        
        // Query DB (async) to check if entries exist to add dot indicator (Optional enhancement)
        const dateStr = formatDate(new Date(year, month, i));
        db.getEntriesByDate(dateStr).then(entries => {
            if (entries.length > 0) dayDiv.classList.add('has-entry');
        });

        calendarDaysEl.appendChild(dayDiv);
    }
}

function formatDate(date) {
    return date.toISOString().split('T')[0];
}

document.getElementById('prev-month').addEventListener('click', () => {
    currentDate.setMonth(currentDate.getMonth() - 1);
    renderCalendar(currentDate);
});
document.getElementById('next-month').addEventListener('click', () => {
    currentDate.setMonth(currentDate.getMonth() + 1);
    renderCalendar(currentDate);
});

/** ==========================================
 *  Timeline Rendering
 *  ========================================== */
async function loadDashboardForDate(date) {
    const dateStr = formatDate(date);
    selectedDateDisplay.textContent = date.toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric' });
    
    const entries = await db.getEntriesByDate(dateStr);
    entriesCountDisplay.textContent = `${entries.length} entries found`;
    
    timelineFeed.innerHTML = '';
    
    if (entries.length === 0) {
        timelineFeed.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon"><i class="ri-book-3-line"></i></div>
                <h3>No entries for this date</h3>
                <p>Click "New Entry" to add your progress for today.</p>
            </div>`;
        return;
    }
    
    // Sort by creation time (assuming id has timestamp)
    entries.sort((a, b) => b.id - a.id);
    
    entries.forEach(entry => {
        const card = document.createElement('div');
        card.classList.add('entry-card');
        
        // Format timeblocks
        let timeBlocksHtml = '';
        if (entry.timeBlocks && entry.timeBlocks.length > 0) {
            timeBlocksHtml = `
            <div class="entry-time-blocks">
                <h4>Time Blocks</h4>
                ${entry.timeBlocks.map(tb => `
                    <div class="time-block-item">
                        <span class="tb-time"><i class="ri-time-line"></i> ${tb.start} - ${tb.end}</span>
                        <span class="tb-desc">${tb.desc}</span>
                    </div>
                `).join('')}
            </div>`;
        }

        // Format Attachments
        let attachmentsHtml = '';
        if (entry.files && entry.files.length > 0) {
            attachmentsHtml = `<div class="entry-attachments">` + 
                entry.files.map(f => {
                    if (f.type.startsWith('image/')) {
                        return `<img src="${f.data}" class="attachment-preview" title="${f.name}" alt="Attachment">`;
                    } else {
                        // File type preview (Document)
                        return `<div class="attachment-preview" style="display:flex; align-items:center; justify-content:center; background:#eee; color:#333; font-size:24px;" title="${f.name}">
                                  <i class="ri-file-text-line"></i>
                                </div>`;
                    }
                }).join('') + `</div>`;
        }
        
        card.innerHTML = `
            <div class="entry-header">
                <div>
                    <h3 class="entry-title">${entry.title}</h3>
                    <div class="entry-meta">
                        <span class="badge priority-${entry.priority}"><i class="ri-flag-line"></i> ${entry.priority}</span>
                        <span class="badge"><i class="ri-emotion-line"></i> ${entry.mood}</span>
                        ${entry.tags ? `<span class="badge"><i class="ri-price-tag-3-line"></i> ${entry.tags}</span>` : ''}
                    </div>
                </div>
                <div class="entry-actions">
                    <button class="icon-btn text-red" onclick="deleteEntry(${entry.id})" title="Delete"><i class="ri-delete-bin-line"></i></button>
                </div>
            </div>
            <div class="entry-notes">${entry.notes}</div>
            ${timeBlocksHtml}
            ${entry.links ? `<div class="entry-links" style="margin-top:12px; font-size:0.9rem;"><a href="${entry.links}" target="_blank" class="text-blue"><i class="ri-link"></i> ${entry.links}</a></div>` : ''}
            ${attachmentsHtml}
        `;
        
        timelineFeed.appendChild(card);
    });
}

window.deleteEntry = async (id) => {
    if (confirm('Are you sure you want to delete this entry?')) {
        await db.deleteEntry(id);
        showToast('Entry deleted');
        loadDashboardForDate(selectedDate);
        updateGlobalStats();
        renderCalendar(currentDate);
    }
};

/** ==========================================
 *  Form Logic & File Upload
 *  ========================================== */
let uploadedFilesData = [];

function setupEventListeners() {
    // Modal controls
    addEntryBtn.addEventListener('click', () => {
        document.getElementById('entry-date').value = formatDate(selectedDate);
        uploadedFilesData = []; // reset files
        document.getElementById('file-preview-container').innerHTML = '';
        entryForm.reset();
        modal.classList.remove('hidden');
    });
    
    closeBtns.forEach(btn => btn.addEventListener('click', () => modal.classList.add('hidden')));
    
    // Dynamic Time Blocks
    const addTbBtn = document.getElementById('add-time-block-btn');
    const tbContainer = document.getElementById('time-blocks-container');
    
    addTbBtn.addEventListener('click', () => {
        const row = document.createElement('div');
        row.classList.add('time-block-row');
        row.innerHTML = `
            <input type="time" class="tb-start" required>
            <span>to</span>
            <input type="time" class="tb-end" required>
            <input type="text" class="tb-desc" placeholder="E.g., Learned CSS" required>
            <button type="button" class="icon-btn text-red remove-tb-btn"><i class="ri-delete-bin-line"></i></button>
        `;
        tbContainer.appendChild(row);
        
        row.querySelector('.remove-tb-btn').addEventListener('click', () => row.remove());
    });
    
    // Initial remove button setup
    document.querySelectorAll('.remove-tb-btn').forEach(btn => {
        btn.addEventListener('click', (e) => e.target.closest('.time-block-row').remove());
    });
    
    // File Upload Drag & Drop
    const fileDropZone = document.getElementById('file-drop-zone');
    const fileInput = document.getElementById('entry-files');
    const previewContainer = document.getElementById('file-preview-container');
    
    fileDropZone.addEventListener('click', () => fileInput.click());
    
    fileDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        fileDropZone.classList.add('dragover');
    });
    fileDropZone.addEventListener('dragleave', () => fileDropZone.classList.remove('dragover'));
    
    fileDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        fileDropZone.classList.remove('dragover');
        handleFiles(e.dataTransfer.files);
    });
    
    fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
    
    function handleFiles(files) {
        for (let file of files) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const dataUrl = e.target.result;
                const fileObj = { name: file.name, type: file.type, data: dataUrl };
                uploadedFilesData.push(fileObj);
                
                // Add preview
                const wrapper = document.createElement('div');
                wrapper.classList.add('preview-wrapper');
                
                if (file.type.startsWith('image/')) {
                    wrapper.innerHTML = `
                        <img src="${dataUrl}" alt="Preview">
                        <button type="button" class="preview-remove"><i class="ri-close-line"></i></button>
                    `;
                } else {
                    wrapper.innerHTML = `
                        <div style="width:100%; height:100%; background:#eee; display:flex; align-items:center; justify-content:center; color:#333;"><i class="ri-file-text-line"></i></div>
                        <button type="button" class="preview-remove"><i class="ri-close-line"></i></button>
                    `;
                }
                
                const removeBtn = wrapper.querySelector('.preview-remove');
                removeBtn.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    wrapper.remove();
                    uploadedFilesData = uploadedFilesData.filter(f => f !== fileObj);
                });
                
                previewContainer.appendChild(wrapper);
            };
            reader.readAsDataURL(file); // Convert to Base64 for IndexedDB storage
        }
    }
    
    // Form Submit
    entryForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        // Gather Time Blocks
        const tbRows = document.querySelectorAll('.time-block-row');
        let timeBlocks = [];
        tbRows.forEach(row => {
            const start = row.querySelector('.tb-start').value;
            const end = row.querySelector('.tb-end').value;
            const desc = row.querySelector('.tb-desc').value;
            if (start && end && desc) {
                timeBlocks.push({ start, end, desc });
            }
        });
        
        const entry = {
            id: Date.now(),
            date: document.getElementById('entry-date').value,
            title: document.getElementById('entry-title').value,
            notes: document.getElementById('entry-notes').value,
            priority: document.getElementById('entry-priority').value,
            tags: document.getElementById('entry-tags').value,
            mood: document.getElementById('entry-mood').value,
            links: document.getElementById('entry-links').value,
            timeBlocks: timeBlocks,
            files: uploadedFilesData
        };
        
        await db.saveEntry(entry);
        showToast('Entry saved successfully!');
        
        modal.classList.add('hidden');
        renderCalendar(currentDate); // Update dots
        loadDashboardForDate(new Date(entry.date + 'T00:00:00')); // Reload selected
        updateGlobalStats();
    });

    // Theme Toggle
    document.getElementById('theme-toggle').addEventListener('click', () => {
        const html = document.documentElement;
        const currentTheme = html.getAttribute('data-theme');
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        html.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        updateChartTheme();
    });

    // Export PDF
    document.getElementById('export-pdf-btn').addEventListener('click', () => {
        const element = document.getElementById('printable-area');
        const opt = {
            margin: 1,
            filename: `progress_report_${formatDate(selectedDate)}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2 },
            jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
        };
        html2pdf().set(opt).from(element).save();
    });
}

function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
}

/** ==========================================
 *  Dashboard Analytics
 *  ========================================== */
async function updateGlobalStats() {
    const allEntries = await db.getAllEntries();
    
    let totalTasks = allEntries.length; // Simply counting entries as tasks for now
    let totalMins = 0;
    let filesCount = 0;
    
    // Group by Date for Chart & Streaks
    const hoursByDate = {};
    const datesWithEntries = new Set();
    
    allEntries.forEach(entry => {
        datesWithEntries.add(entry.date);
        
        if (entry.files) filesCount += entry.files.length;
        
        if (!hoursByDate[entry.date]) hoursByDate[entry.date] = 0;
        
        if (entry.timeBlocks) {
            entry.timeBlocks.forEach(tb => {
                // Calculate duration in minutes
                const startArr = tb.start.split(':');
                const endArr = tb.end.split(':');
                const startMins = parseInt(startArr[0]) * 60 + parseInt(startArr[1]);
                let endMins = parseInt(endArr[0]) * 60 + parseInt(endArr[1]);
                if (endMins < startMins) endMins += 24 * 60; // Handle over-midnight
                
                const diff = endMins - startMins;
                totalMins += diff;
                hoursByDate[entry.date] += (diff / 60);
            });
        }
    });
    
    document.getElementById('stat-tasks').textContent = totalTasks;
    document.getElementById('stat-hours').textContent = (totalMins / 60).toFixed(1) + 'h';
    document.getElementById('stat-files').textContent = filesCount;
    
    // Calculate Streak (consecutive days looking backwards from today)
    let currentStreak = 0;
    let checkDate = new Date();
    while (true) {
        let dStr = formatDate(checkDate);
        if (datesWithEntries.has(dStr)) {
            currentStreak++;
            checkDate.setDate(checkDate.getDate() - 1);
        } else {
            // Check if today is just unlogged, but yesterday was logged
            if (currentStreak === 0 && formatDate(new Date()) === dStr) {
                checkDate.setDate(checkDate.getDate() - 1);
                dStr = formatDate(checkDate);
                if (datesWithEntries.has(dStr)) {
                     currentStreak++;
                     checkDate.setDate(checkDate.getDate() - 1);
                     continue;
                }
            }
            break;
        }
    }
    document.getElementById('stat-streak').textContent = currentStreak;

    updateChart(hoursByDate);
}

function updateChart(hoursByDate) {
    const ctx = document.getElementById('progressChart').getContext('2d');
    
    // Generate dates for the last 7 days
    const labels = [];
    const data = [];
    
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dStr = formatDate(d);
        labels.push(d.toLocaleDateString('default', { weekday: 'short' }));
        data.push(hoursByDate[dStr] ? hoursByDate[dStr].toFixed(1) : 0);
    }
    
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#9ca3af' : '#6b7280';
    const gridColor = isDark ? '#2d333b' : '#e5e7eb';

    if (chartInstance) {
        chartInstance.destroy();
    }
    
    chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Hours',
                data: data,
                backgroundColor: '#3b82f6',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: gridColor },
                    ticks: { color: textColor }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: textColor }
                }
            }
        }
    });
}

function updateChartTheme() {
    updateGlobalStats(); // Re-renders chart with new grid colors
}

/** ==========================================
 *  Utility
 *  ========================================== */
function showToast(message) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.classList.add('toast');
    toast.innerHTML = `<i class="ri-check-line text-green"></i> <span>${message}</span>`;
    
    container.appendChild(toast);
    
    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 10);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

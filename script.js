/*
  LAFVIN ESP Web Flasher - UI 交互层
*/
import {
    connectToDevice, disconnectDevice, startFlashing,
    getConnectedPort, consoleTerminal, fitAddon,
    changeBaudRate, serialMonitorTerminal, monitorFitAddon,
    startSerialMonitor, stopSerialMonitor,
    sendSerialData, clearSerialTerminal
} from './esptool-integration.js';

document.addEventListener('DOMContentLoaded', () => {
    // --- DOM 引用 ---
    const body = document.body;
    const selectDeviceBtn = document.getElementById('select-device-btn');
    const firmwareSelect = document.getElementById('firmware-select');
    const versionSelect = document.getElementById('version-select');
    const connectBtn = document.getElementById('connect-btn');
    const flashBtn = document.getElementById('flash-btn');
    const toggleConsoleBtn = document.getElementById('toggle-console-btn');
    const serialPortInfoBtn = document.getElementById('serial-port-info-btn');
    const supportBtn = document.getElementById('support-btn');
    const themeSwitcher = document.getElementById('theme-switcher');
    const baudRateSelect = document.getElementById('baud-rate-select');
    const terminalSection = document.querySelector('.terminal-section');
    const deviceModal = document.getElementById('device-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const deviceList = document.getElementById('device-list');
    const serialInfoModal = document.getElementById('serial-info-modal');
    const closeSerialInfoModalBtn = document.getElementById('close-serial-info-modal-btn');
    const supportModal = document.getElementById('support-modal');
    const closeSupportModalBtn = document.getElementById('close-support-modal-btn');
    const modalBaudRateSelect = document.getElementById('modal-baud-rate-select');
    const clearTerminalBtn = document.getElementById('clear-terminal-btn');
    const serialSendInput = document.getElementById('serial-send-input');
    const serialSendBtn = document.getElementById('serial-send-btn');
    const step2 = document.getElementById('step-2');
    const step3 = document.getElementById('step-3');
    const versionNotesWrapper = document.getElementById('version-notes-wrapper');
    const versionNotesBtn = document.getElementById('version-notes-btn');
    const versionNotesTooltip = document.getElementById('version-notes-tooltip');
    const versionNotesModal = document.getElementById('version-notes-modal');
    const closeVersionNotesModalBtn = document.getElementById('close-version-notes-modal-btn');
    const versionNotesContent = document.getElementById('version-notes-content');

    // --- 状态 ---
    let appConfig = null;
    let selectedDevice = null;
    let selectedFirmware = null;
    let selectedVersion = null;
    let isConnected = false;
    let versionNotesText = '';

    // 挂载串口监视器终端
    const serialMonitorTerminalElement = document.getElementById('serial-monitor-terminal');
    serialMonitorTerminal.open(serialMonitorTerminalElement);

    // --- 工具函数 ---
    function toggleModal(el) { el.classList.toggle('is-visible'); }

    function populateDropdown(select, items, placeholder) {
        select.innerHTML = `<option value="">${placeholder}</option>`;
        items.forEach(item => {
            const opt = document.createElement('option');
            opt.value = item.id;
            opt.textContent = item.name;
            select.appendChild(opt);
        });
    }

    function getDeviceSeries(device) {
        if (device?.series) return String(device.series).toUpperCase();

        const candidates = [device?.id, device?.name, device?.image].filter(Boolean);
        for (const value of candidates) {
            const match = String(value).match(/\b(LA|LB)\d*/i);
            if (match) return match[1].toUpperCase();
        }

        return 'OTHER';
    }

    function updateButtonStates() {
        const canFlash = selectedDevice && selectedFirmware && selectedVersion;
        connectBtn.innerHTML = isConnected
            ? '<i class="fas fa-unlink"></i> Disconnect'
            : '<i class="fas fa-link"></i> Connect';
        flashBtn.disabled = !(isConnected && canFlash);
        serialPortInfoBtn.disabled = !isConnected;
    }

    // --- 设备轮播渲染 ---

    function resetVersionNotes() {
        versionNotesText = '';
        versionNotesTooltip.textContent = 'No notes';
        versionNotesContent.textContent = '';
        versionNotesWrapper.classList.add('is-hidden');
    }

    async function loadVersionNotes(version) {
        resetVersionNotes();
        if (!version?.notes_path) return;
        try {
            const response = await fetch(version.notes_path);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const text = await response.text();
            versionNotesText = (text || '').trim() || 'No notes available.';
        } catch (error) {
            versionNotesText = 'Notes file not found.';
        }
        versionNotesTooltip.textContent = versionNotesText;
        versionNotesContent.textContent = versionNotesText;
        versionNotesWrapper.classList.remove('is-hidden');
    }

    // --- Device carousel ---
    function renderDeviceCarousel() {
        if (!appConfig?.devices) return;
        deviceList.innerHTML = '';
        const visibleDevices = appConfig.devices.filter(d => !d.hidden);
        const groupedDevices = new Map([
            ['LA', []],
            ['LB', []],
            ['OTHER', []]
        ]);

        visibleDevices.forEach(device => {
            const series = getDeviceSeries(device);
            if (!groupedDevices.has(series)) groupedDevices.set(series, []);
            groupedDevices.get(series).push(device);
        });

        ['LA', 'LB', 'OTHER'].forEach(series => {
            const devices = groupedDevices.get(series) || [];
            if (!devices.length) return;

            const section = document.createElement('section');
            section.className = 'device-group';

            const title = document.createElement('h3');
            title.className = 'device-group-title';
            title.textContent = series === 'OTHER' ? 'Other' : `${series} Series`;

            const track = document.createElement('div');
            track.className = 'device-group-track';

            const leftArrow = document.createElement('button');
            leftArrow.className = 'modal-nav-arrow device-group-arrow';
            leftArrow.type = 'button';
            leftArrow.setAttribute('aria-label', `${series} series scroll left`);
            leftArrow.innerHTML = '<i class="fas fa-chevron-left"></i>';

            const scrollArea = document.createElement('div');
            scrollArea.className = 'device-group-scroll';

            const items = document.createElement('div');
            items.className = 'device-group-items';

            devices.forEach(device => {
                const item = document.createElement('div');
                item.className = 'device-item';
                item.innerHTML = `
                    <div class="device-image-wrapper">
                        <img src="${device.image || ''}" alt="${device.name}" class="device-image-placeholder"
                             onerror="this.style.display='none'" />
                    </div>
                    <span class="device-name">${device.name}</span>
                `;
                item.addEventListener('click', () => handleDeviceSelection(device));
                items.appendChild(item);
            });

            const rightArrow = document.createElement('button');
            rightArrow.className = 'modal-nav-arrow device-group-arrow';
            rightArrow.type = 'button';
            rightArrow.setAttribute('aria-label', `${series} series scroll right`);
            rightArrow.innerHTML = '<i class="fas fa-chevron-right"></i>';

            leftArrow.addEventListener('click', () => {
                items.scrollBy({ left: -360, behavior: 'smooth' });
            });
            rightArrow.addEventListener('click', () => {
                items.scrollBy({ left: 360, behavior: 'smooth' });
            });

            scrollArea.appendChild(items);
            track.appendChild(leftArrow);
            track.appendChild(scrollArea);
            track.appendChild(rightArrow);
            section.appendChild(title);
            section.appendChild(track);
            deviceList.appendChild(section);
        });
    }

    function handleDeviceSelection(device) {
        selectedDevice = device;
        selectedFirmware = null;
        selectedVersion = null;
        resetVersionNotes();
        selectDeviceBtn.innerHTML = `<span>${device.name}</span>`;
        selectDeviceBtn.classList.add('selected');

        if (device.firmwares?.length) {
            populateDropdown(firmwareSelect, device.firmwares, 'Select firmware');
            firmwareSelect.disabled = false;
            step2.classList.add('active');
        } else {
            firmwareSelect.disabled = true;
            step2.classList.remove('active');
        }
        populateDropdown(versionSelect, [], 'Select version');
        versionSelect.disabled = true;
        step3.classList.remove('active');
        updateButtonStates();
        toggleModal(deviceModal);
    }

    // --- 主题 ---
    function setTheme(theme) {
        localStorage.setItem('theme', theme);
        body.className = theme === 'light' ? 'light-mode' : '';
        themeSwitcher.innerHTML = theme === 'light' ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
    }
    function loadTheme() {
        const saved = localStorage.getItem('theme');
        setTheme(saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
    }

    // --- 事件监听 ---
    window.addEventListener('resize', () => {
        if (serialInfoModal.classList.contains('is-visible')) monitorFitAddon.fit();
        fitAddon.fit();
    });

    navigator.serial?.addEventListener('disconnect', async () => {
        if (isConnected) {
            isConnected = false;
            await disconnectDevice();
            consoleTerminal.writeLine("Device disconnected (Event).");
            updateButtonStates();
        }
    });

    selectDeviceBtn.addEventListener('click', () => toggleModal(deviceModal));
    closeModalBtn.addEventListener('click', () => toggleModal(deviceModal));
    deviceModal.addEventListener('click', (e) => { if (e.target === deviceModal) toggleModal(deviceModal); });

    closeSerialInfoModalBtn.addEventListener('click', () => toggleModal(serialInfoModal));
    serialInfoModal.addEventListener('click', (e) => { if (e.target === serialInfoModal) toggleModal(serialInfoModal); });
    supportBtn.addEventListener('click', () => toggleModal(supportModal));
    closeSupportModalBtn.addEventListener('click', () => toggleModal(supportModal));
    supportModal.addEventListener('click', (e) => { if (e.target === supportModal) toggleModal(supportModal); });
    closeVersionNotesModalBtn.addEventListener('click', () => toggleModal(versionNotesModal));
    versionNotesModal.addEventListener('click', (e) => { if (e.target === versionNotesModal) toggleModal(versionNotesModal); });

    themeSwitcher.addEventListener('click', () => {
        setTheme(body.classList.contains('light-mode') ? 'dark' : 'light');
    });

    firmwareSelect.addEventListener('change', () => {
        selectedFirmware = selectedDevice?.firmwares.find(f => f.id === firmwareSelect.value) || null;
        selectedVersion = null;
        resetVersionNotes();
        if (selectedFirmware?.versions?.length) {
            populateDropdown(versionSelect, selectedFirmware.versions, 'Select version');
            versionSelect.disabled = false;
            step3.classList.add('active');
        } else {
            populateDropdown(versionSelect, [], 'No versions');
            versionSelect.disabled = true;
            step3.classList.remove('active');
        }
        updateButtonStates();
    });

    versionSelect.addEventListener('change', () => {
        selectedVersion = selectedFirmware?.versions.find(v => v.id === versionSelect.value) || null;
        loadVersionNotes(selectedVersion);
        updateButtonStates();
    });

    versionNotesBtn.addEventListener('click', () => {
        if (versionNotesWrapper.classList.contains('is-hidden')) return;
        toggleModal(versionNotesModal);
    });

    // 连接/断开
    connectBtn.addEventListener('click', async () => {
        const monitorBaudRate = parseInt(modalBaudRateSelect.value);
        if (!isConnected) {
            connectBtn.disabled = true;
            connectBtn.textContent = 'Connecting...';
            try {
                await connectToDevice(monitorBaudRate);
                isConnected = true;
            } catch (e) { isConnected = false; }
            finally { connectBtn.disabled = false; updateButtonStates(); }
        } else {
            connectBtn.disabled = true;
            connectBtn.textContent = 'Disconnecting...';
            try { await disconnectDevice(); isConnected = false; }
            catch (e) {}
            finally { connectBtn.disabled = false; updateButtonStates(); }
        }
    });

    // 烧录
    flashBtn.addEventListener('click', async () => {
        if (!isConnected) return;
        // 自动打开控制台
        if (terminalSection.classList.contains('hidden')) {
            terminalSection.classList.remove('hidden');
            toggleConsoleBtn.innerHTML = '<i class="fas fa-terminal"></i> Close Console';
            fitAddon.fit();
            setTimeout(() => terminalSection.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
        }
        flashBtn.disabled = true;
        connectBtn.disabled = true;
        serialPortInfoBtn.disabled = true;
        flashBtn.textContent = 'Flashing...';
        const eraseFlash = document.getElementById('erase-flash-checkbox')?.checked || false;
        const flashBaudRate = parseInt(baudRateSelect.value);
        try {
            await startFlashing(selectedVersion, eraseFlash, flashBaudRate);
        } catch (e) {
            if (!getConnectedPort()) isConnected = false;
        } finally {
            flashBtn.disabled = false;
            connectBtn.disabled = false;
            flashBtn.innerHTML = '<i class="fas fa-bolt"></i> Flash';
            updateButtonStates();
        }
    });

    toggleConsoleBtn.addEventListener('click', () => {
        terminalSection.classList.toggle('hidden');
        toggleConsoleBtn.innerHTML = terminalSection.classList.contains('hidden')
            ? '<i class="fas fa-terminal"></i> Open Console'
            : '<i class="fas fa-terminal"></i> Close Console';
        if (!terminalSection.classList.contains('hidden')) fitAddon.fit();
    });

    serialPortInfoBtn.addEventListener('click', () => {
        if (!isConnected) return;
        toggleModal(serialInfoModal);
        setTimeout(() => monitorFitAddon.fit(), 100);
    });

    modalBaudRateSelect.addEventListener('change', async () => {
        if (isConnected) await changeBaudRate(parseInt(modalBaudRateSelect.value));
    });

    clearTerminalBtn.addEventListener('click', () => clearSerialTerminal());

    serialSendBtn.addEventListener('click', async () => {
        if (serialSendInput.value) {
            await sendSerialData(serialSendInput.value + '\r\n');
            serialSendInput.value = '';
        }
    });
    serialSendInput.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter' && serialSendInput.value) {
            await sendSerialData(serialSendInput.value + '\r\n');
            serialSendInput.value = '';
        }
    });

    // --- 初始化 ---
    async function initializeApp() {
        loadTheme();
        try {
            const response = await fetch('firmware/config.json');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            appConfig = await response.json();
            renderDeviceCarousel();
            updateButtonStates();
        } catch (error) {
            consoleTerminal.writeLine('Error: Could not load firmware/config.json');
        }
    }

    initializeApp();
});

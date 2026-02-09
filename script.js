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
    const themeSwitcher = document.getElementById('theme-switcher');
    const baudRateSelect = document.getElementById('baud-rate-select');
    const terminalSection = document.querySelector('.terminal-section');
    const deviceModal = document.getElementById('device-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const deviceList = document.getElementById('device-list');
    const leftArrow = document.querySelector('.left-arrow');
    const rightArrow = document.querySelector('.right-arrow');
    const serialInfoModal = document.getElementById('serial-info-modal');
    const closeSerialInfoModalBtn = document.getElementById('close-serial-info-modal-btn');
    const modalBaudRateSelect = document.getElementById('modal-baud-rate-select');
    const clearTerminalBtn = document.getElementById('clear-terminal-btn');
    const serialSendInput = document.getElementById('serial-send-input');
    const serialSendBtn = document.getElementById('serial-send-btn');
    const step2 = document.getElementById('step-2');
    const step3 = document.getElementById('step-3');

    // --- 状态 ---
    let appConfig = null;
    let selectedDevice = null;
    let selectedFirmware = null;
    let selectedVersion = null;
    let isConnected = false;

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

    function updateButtonStates() {
        const canFlash = selectedDevice && selectedFirmware && selectedVersion;
        connectBtn.innerHTML = isConnected
            ? '<i class="fas fa-unlink"></i> Disconnect'
            : '<i class="fas fa-link"></i> Connect';
        flashBtn.disabled = !(isConnected && canFlash);
        serialPortInfoBtn.disabled = !isConnected;
    }

    // --- 设备轮播渲染 ---
    function renderDeviceCarousel() {
        if (!appConfig?.devices) return;
        deviceList.innerHTML = '';
        appConfig.devices.forEach(device => {
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
            deviceList.appendChild(item);
        });
    }

    function handleDeviceSelection(device) {
        selectedDevice = device;
        selectedFirmware = null;
        selectedVersion = null;
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

    themeSwitcher.addEventListener('click', () => {
        setTheme(body.classList.contains('light-mode') ? 'dark' : 'light');
    });

    leftArrow.addEventListener('click', () => deviceList.scrollBy({ left: -300, behavior: 'smooth' }));
    rightArrow.addEventListener('click', () => deviceList.scrollBy({ left: 300, behavior: 'smooth' }));

    firmwareSelect.addEventListener('change', () => {
        selectedFirmware = selectedDevice?.firmwares.find(f => f.id === firmwareSelect.value) || null;
        selectedVersion = null;
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
        updateButtonStates();
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

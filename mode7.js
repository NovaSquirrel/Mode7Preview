let framecount = 0;
let animationEnabled = false;
let animationWaiting = false;

function openTab(evt, tabName) {
  // From https://www.w3schools.com/howto/howto_js_tabs.asp
  // Declare all variables
  var i, tabcontent, tablinks;

  // Get all elements with class="tabcontent" and hide them
  tabcontent = document.getElementsByClassName("tabcontent");
  for (i = 0; i < tabcontent.length; i++) {
    tabcontent[i].style.display = "none";
  }

  // Get all elements with class="tablinks" and remove the class "active"
  tablinks = document.getElementsByClassName("tablinks");
  for (i = 0; i < tablinks.length; i++) {
    tablinks[i].className = tablinks[i].className.replace(" active", "");
  }

  // Show the current tab, and add an "active" class to the button that opened the tab
  document.getElementById(tabName).style.display = "block";
  evt.currentTarget.className += " active";
}


function clip(val) { return (val & 0x2000) ? (val | ~0x3ff) : (val & 0x3ff); }
function toFixed(f) { return Math.round(f*256) & 0xffff};
function signExtend16(v) {
	if(v & 0x8000) {
		return v | (-1 & ~0xffff);
	}
	return v;
}

// Drawing commands
let drawingQueue = [];
let canDraw = false;
function ellipse(x, y, width, height, color, filled) {
	if(canDraw)
		drawingQueue.push(['E', x, y, width, height, color, filled]);
}
function rectangle(x, y, width, height, color, filled) {
	if(canDraw)
		drawingQueue.push(['R', x, y, width, height, color, filled]);
}
function line(x1, y1, x2, y2, color) {
	if(canDraw)
		drawingQueue.push(['L', x1, y1, x2, y2, color, false]);
}

// Set all of the Mode 7 register globals if it's an array
function setRegistersIfArray(output) {
	if(output !== undefined && Array.isArray(output) && output.length == 8) {
		m7a = output[0];
		m7b = output[1];
		m7c = output[2];
		m7d = output[3];
		m7x = output[4];
		m7y = output[5];
		m7hofs = output[6];
		m7vofs = output[7];
		return true;
	}
	return false;
}

function rerender() {
	let sourceCode = document.getElementById('code').value;
	let sourceValidSignal = document.getElementById('sourceValid');
	let ctx = document.getElementById('screen').getContext('2d', { alpha: false });

	let tilemapCanvas = document.getElementById('tilemapCanvas');
	let tilemapCtx = tilemapCanvas.getContext('2d', { alpha: false });

	let variable1 = parseFloat(document.getElementById('variable1').value);
	if(variable1 == NaN)
		variable1 = 0;
	let variable2 = parseFloat(document.getElementById('variable2').value);
	if(variable2 == NaN)
		variable2 = 0;
	let variable3 = parseFloat(document.getElementById('variable3').value);
	if(variable3 == NaN)
		variable3 = 0;

	// Get the function ready to be called
	let scanlineFunction;
	try {
		scanlineFunction = Function("scanline", "framecount", "var1", "var2", "var3", sourceCode);
		sourceValidSignal.checked = true;
		document.getElementById('errorText').textContent = '';
	} catch(err) {
		lastRunFailed = true;
		sourceValidSignal.checked = false;
		console.log(err);
		document.getElementById('errorText').textContent = err;
		return;
	}
	// If not null, it's a per-frame per-scanline model
	let frameObject = null;

	// Set everything up
	tilemapCtx.clearRect(0, 0, 1024, 1024);
	tilemapCtx.drawImage(document.getElementById('tilemapImg'), 0, 0);
	let tilemapPixels = tilemapCtx.getImageData(0, 0, 1024, 1024).data;
	let outImage = ctx.createImageData(256, 224);
	let outPixels = outImage.data;

	for(let drawY=0; drawY<224; drawY++) {
		// Mode 7 registers
		try {
			if(frameObject) {
				setRegistersIfArray(scanlineFunction(drawY, frameObject));
			} else {
				canDraw = drawY == 223;
				let output = scanlineFunction(drawY, framecount, variable1, variable2, variable3);
				if(setRegistersIfArray(output)) {

				} else if(output !== undefined && Array.isArray(output) &&
				  output.length == 2 && typeof(output[0]) == 'function' && typeof(output[1]) == 'function') {
					frameObject = output[0](framecount, variable1, variable2, variable3);
					scanlineFunction = output[1];
					setRegistersIfArray(scanlineFunction(drawY, frameObject));
				}
			}
		} catch(err) {
			sourceValidSignal.checked = false;
			console.log(err);
			document.getElementById('errorText').textContent = err;
			return;
		}
		m7a = signExtend16(m7a);
		m7b = signExtend16(m7b);
		m7c = signExtend16(m7c);
		m7d = signExtend16(m7d);

		// Based on Mesen-S's Ppu.cpp
		let xValue = (
			((m7a * clip(m7hofs - m7x)) & ~63) +
			((m7b * drawY) & ~63) +
			((m7b * clip(m7vofs - m7y)) & ~63) +
			(m7x << 8)
		);

		let yValue = (
			((m7c * clip(m7hofs - m7x)) & ~63) +
			((m7d * drawY) & ~63) +
			((m7d * clip(m7vofs - m7y)) & ~63) +
			(m7y << 8)
		);

		let xStep = m7a;
		let yStep = m7c;

		for(let drawX=0; drawX<256; drawX++) {
			let xOffset = xValue >> 8;
			let yOffset = yValue >> 8;
			xValue += xStep;
			yValue += yStep;

			yOffset &= 0x3FF; // Wrap
			xOffset &= 0x3FF;

			let screenIndex = (drawY*256+drawX)*4;
			let tilemapIndex = (yOffset*1024+xOffset)*4;

			outPixels[screenIndex]     = tilemapPixels[tilemapIndex];
			outPixels[screenIndex + 1] = tilemapPixels[tilemapIndex + 1];
			outPixels[screenIndex + 2] = tilemapPixels[tilemapIndex + 2];
			outPixels[screenIndex + 3] = tilemapPixels[tilemapIndex + 3];
		}
	}

	ctx.putImageData(outImage, 0, 0);

	while(drawingQueue.length) {
		let [type, drawX, drawY, width, height, color, filled] = drawingQueue.shift();

		ctx.strokeStyle = color;
		ctx.fillStyle = color;
		ctx.beginPath();
		switch(type) {
			case 'E':
				ctx.ellipse(drawX, drawY, width, height, 0, 0, 2 * Math.PI);
				break;
			case 'R':
				ctx.rect(drawX, drawY, width, height);
				break;
			case 'L':
				ctx.moveTo(drawX, drawY);
				ctx.lineTo(width, height);
				break;
		}
		if(filled)
			ctx.fill();
		else
			ctx.stroke();
	}

	if(animationEnabled && !animationWaiting) {
		window.requestAnimationFrame(animationStep);
		animationWaiting = true;
	}
}

function rerenderButton() {
	animationStart = undefined;
	rerender();
}

let animationStart;
function animationStep(timestamp) {
	animationWaiting = false;
	if(animationStart == undefined) {
		animationStart = timestamp;
	}
	framecount = Math.floor((timestamp - animationStart)/(16.0+2.0/3.0));
	if(animationEnabled) {
		rerender();
	}
}

function animationToggled(cb) {
	animationEnabled = cb.checked;
	if(animationEnabled) {
		animationStart = undefined;
		rerender();
	} else {
		animationWaiting = false;
	}
}

function rerenderIfLive() {
	if(document.getElementById('rerenderLive').checked)
		rerender();
}

function syntaxCa65() {
	document.getElementById('generateByte1').value = ".byte ";
	document.getElementById('generateByte2').value = "";
	document.getElementById('generateWord1').value = ".word ";
	document.getElementById('generateWord2').value = "";
	document.getElementById('generateAddress1').value = ".addr .loword(";
	document.getElementById('generateAddress2').value = ")";
}

function syntaxAsar() {
	document.getElementById('generateByte1').value = "db ";
	document.getElementById('generateByte2').value = "";
	document.getElementById('generateWord1').value = "dw ";
	document.getElementById('generateWord2').value = "";
	document.getElementById('generateAddress1').value = "dw ";
	document.getElementById('generateAddress2').value = "";
}

function generateTables() {
	let sourceCode = document.getElementById('code').value;
	let variable1 = parseFloat(document.getElementById('generate1Start').value);
	if(variable1 == NaN)
		variable1 = 0;
	let variable1End = parseFloat(document.getElementById('generate1End').value);
	if(variable1End == NaN)
		variable1End = 0;
	let variable1Step = parseFloat(document.getElementById('generate1Step').value);
	if(variable1Step == NaN)
		variable1Step = 0;
	let variable2 = parseFloat(document.getElementById('generate2').value);
	if(variable2 == NaN)
		variable2 = 0;
	let variable3 = parseFloat(document.getElementById('generate3').value);
	if(variable3 == NaN)
		variable3 = 0;

	let generateByte1 = document.getElementById('generateByte1').value;
	let generateByte2 = document.getElementById('generateByte2').value;
	let generateWord1 = document.getElementById('generateWord1').value;
	let generateWord2 = document.getElementById('generateWord2').value;
	let generateAddress1 = document.getElementById('generateAddress1').value;
	let generateAddress2 = document.getElementById('generateAddress2').value;

	let generateA = document.getElementById('generateA').checked;
	let generateB = document.getElementById('generateB').checked;
	let generateC = document.getElementById('generateC').checked;
	let generateD = document.getElementById('generateD').checked;
	let generateX = document.getElementById('generateX').checked;
	let generateY = document.getElementById('generateY').checked;
	let generateH = document.getElementById('generateH').checked;
	let generateV = document.getElementById('generateV').checked;
	let generatePair = document.getElementById('generatePaired').checked;
	let generatePointers = document.getElementById('generatePointers').checked;
	let tableName = document.getElementById('generateName').value;

	// Get the function ready to be called
	let scanlineFunction;
	try {
		scanlineFunction = Function("scanline", "framecount", "var1", "var2", "var3", sourceCode);
		document.getElementById('errorText').textContent = '';
	} catch(err) {
		lastRunFailed = true;
		console.log(err);
		document.getElementById('errorText').textContent = err;
		return;
	}

	// Get all the data
	let loop_data = [];
	let iterations = 0;
	let loopvar1 = variable1;
	while(true) {
		iterations++;
		if(iterations > 8192) {
			document.getElementById('errorText').textContent = 'Loop doesn\'t finish?';
			return;
		}
		let m7a_array = [], m7b_array = [];
		let m7c_array = [], m7d_array = [];
		let m7x_array = [], m7y_array = [];
		let m7h_array = [], m7v_array = [];
		
		for(let drawY=0; drawY<224; drawY++) {
			try {
				let output = scanlineFunction(drawY, framecount, loopvar1, variable2, variable3);
				if(output !== undefined) {
					m7a = output[0];
					m7b = output[1];
					m7c = output[2];
					m7d = output[3];
					m7x = output[4];
					m7y = output[5];
					m7hofs = output[6];
					m7vofs = output[7];
				}
				m7a_array.push(m7a);
				m7b_array.push(m7b);
				m7c_array.push(m7c);
				m7d_array.push(m7d);
				m7x_array.push(m7x);
				m7y_array.push(m7y);
				m7h_array.push(m7hofs);
				m7v_array.push(m7vofs);
			} catch(err) {
				console.log(err);
				document.getElementById('errorText').textContent = err;
				return;
			}
		}

		loop_data.push([m7a_array, m7b_array, m7c_array, m7d_array, m7x_array, m7y_array, m7h_array, m7v_array]);

		loopvar1 += variable1Step;
		if(variable1Step == 0) break;
		if(variable1Step > 0 && loopvar1 > variable1End) break;
		if(variable1Step < 0 && loopvar1 < variable1End) break;
	}

	// Format it into a table
	let output = '';
	let indent = '  ';
	let pointersToMake = [];

	function sanitizeEntry(value) {
		value = Math.round(value);
		if(value > 0xffff)
			return 0xffff;
		if(value < 0)
			return 0;
		return value;
	}

	function generateOneTable(do1, index1, name1, do2, index2, name2) {
		if(do1 && !do2) { // First
			pointersToMake.push(name1);
			for(let i=0; i<loop_data.length; i++) {
				output += tableName + '_' + name1 + ((loop_data.length != 1) ? ('_' + i) : '') + ':\n';
				let data = loop_data[i][index1];
				let previous = null;
				let count = 0;
				for(let scanline=0; scanline<data.length; scanline++) {
					let value = sanitizeEntry(data[scanline]);

					if(value != previous || count == 127) {
						if(count != 0) {
							output += indent + generateByte1 + count + generateByte2 + '\n';
							output += indent + generateWord1 + previous + generateWord2 + '\n';
						}
						previous = value;
						count = 1;
					} else {
						count++;
					}
				}
				output += indent + generateByte1 + count + generateByte2 + '\n';
				output += indent + generateWord1 + previous + generateWord2 + '\n';
				output += indent + generateByte1 + '0' + generateByte2 + '\n';
			}
		}
		else if(!do1 && do2) { // Second
			generateOneTable(true, index2, name2, false, null, null);
		}
		else if(do1 && do2) { // Both
			pointersToMake.push(name1 + '_' + name2);
			for(let i=0; i<loop_data.length; i++) {
				output += tableName + '_' + name1 + '_' + name2 + ((loop_data.length != 1) ? ('_' + i) : '') + ':\n';
				let data1 = loop_data[i][index1];
				let data2 = loop_data[i][index2];
				let previous1 = null;
				let previous2 = null;
				let count = 0;
				for(let scanline=0; scanline<data1.length; scanline++) {
					let value1 = sanitizeEntry(data1[scanline]);
					let value2 = sanitizeEntry(data2[scanline]);

					if(value1 != previous1 || value2 != previous2 || count == 127) {
						if(count != 0) {
							output += indent + generateByte1 + count + generateByte2 + '\n';
							output += indent + generateWord1 + previous1 + generateWord2 + '\n';
							output += indent + generateWord1 + previous2 + generateWord2 + '\n';
						}
						previous1 = value1;
						previous2 = value2;
						count = 1;
					} else {
						count++;
					}
				}
				output += indent + generateByte1 + count + generateByte2 + '\n';
				output += indent + generateWord1 + previous1 + generateWord2 + '\n';
				output += indent + generateWord1 + previous2 + generateWord2 + '\n';
				output += indent + generateByte1 + '0' + generateByte2 + '\n';
			}
		}
	}

	if(generatePair) {
		generateOneTable(generateA, 0, "m7a",    generateB, 1, "m7b");
		generateOneTable(generateC, 2, "m7c",    generateD, 3, "m7d");
		generateOneTable(generateX, 4, "m7x",    generateY, 5, "m7y");
		generateOneTable(generateH, 6, "m7hofs", generateV, 7, "m7vofs");
	} else {
		generateOneTable(generateA, 0, "m7a",    false, null, null);
		generateOneTable(generateB, 1, "m7b",    false, null, null);
		generateOneTable(generateC, 2, "m7c",    false, null, null);
		generateOneTable(generateD, 3, "m7d",    false, null, null);
		generateOneTable(generateX, 4, "m7x",    false, null, null);
		generateOneTable(generateY, 5, "m7y",    false, null, null);
		generateOneTable(generateH, 6, "m7hofs", false, null, null);
		generateOneTable(generateV, 7, "m7vofs", false, null, null);
	}

	if(generatePointers && loop_data.length > 1) {
		for(name of pointersToMake) {
			output += tableName + '_' + name + '_' + 'pointers:\n';
			for(let i=0; i<loop_data.length; i++) {
				output += indent + generateAddress1 + tableName + '_' + name + '_' + i + generateAddress2 + '\n';
			}
		}
	}

	document.getElementById('generateOutput').value = output;
}

function copyToClipboard() {
  var copyText = document.getElementById("generateOutput");
  copyText.select();
  copyText.setSelectionRange(0, 99999); /* For mobile devices */
  document.execCommand("copy");
}

function loaded() {
	rerender();

	document.getElementById('tilesetFilePicker').onchange = function (evt) {
		let tgt = evt.target || window.event.srcElement, files = tgt.files;

		// FileReader support
		if(FileReader && files && files.length) {
			let fr = new FileReader();
			fr.onload = function () {
				document.getElementById('tilemapImg').src = fr.result;
				rerender();
			}
			fr.readAsDataURL(files[0]);
		} else {
			// Not supported
			console.log('FileReader not supported');
		}
	}

	document.getElementById("defaultOpen").click();
}

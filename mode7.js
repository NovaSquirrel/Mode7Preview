m7a = 0;
m7b = 0;
m7c = 0;
m7d = 0;
m7x = 0;
m7y = 0;
m7hofs = 0;
m7vofs = 0;

function clip(val) { return (val & 0x2000) ? (val | ~0x3ff) : (val & 0x3ff); }
function toFixed(f) { return Math.round(f*256) & 0xffff};

function rerender() {
	let sourceCode = document.getElementById('code').value;
	let sourceValidSignal = document.getElementById('sourceValid');
	let ctx = document.getElementById('screen').getContext('2d', { alpha: false });

	let tilemapCanvas = document.getElementById('tilemapCanvas');
	let tilemapCtx = tilemapCanvas.getContext('2d', { alpha: false });

	// Get the function ready to be called
	let scanlineFunction;
	try {
		scanlineFunction = Function("scanline", sourceCode);
		sourceValidSignal.checked = true;
		document.getElementById('errorText').textContent = '';
	} catch(err) {
		sourceValidSignal.checked = false;
		console.log(err);
		document.getElementById('errorText').textContent = err;
		return;
	}

	// Set everything up
	tilemapCtx.clearRect(0, 0, 1024, 1024);
	tilemapCtx.drawImage(document.getElementById('tilemapImg'), 0, 0);
	let tilemapPixels = tilemapCtx.getImageData(0, 0, 1024, 1024).data;
	let outImage = ctx.createImageData(256, 224);
	let outPixels = outImage.data;

	for(let drawY=0; drawY<224; drawY++) {
		// Mode 7 registers
		try {
			let [m7a, m7b, m7c, m7d, m7x, m7y, m7hofs, m7vofs] = scanlineFunction(drawY);
		} catch(err) {
			sourceValidSignal.checked = false;
			console.log(err);
			document.getElementById('errorText').textContent = err;
			return;
		}
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
}

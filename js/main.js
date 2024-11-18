// Three.js scene setup
let scene, camera, renderer, particles, raycaster, mouse;
let particleSystem;
const particlesCount = 300;
const maxConnections = 400; // Increased from 50
const connectionDistance = 200; // Increased from 150
const connectionDistanceSquared = connectionDistance * connectionDistance;
const mouseConnectionDistance = 200;
let lines = [];
let isHomeVisible = true;
let isMouseInHome = true;
let frameCount = 0;

// Spatial grid for optimized proximity detection
const gridSize = connectionDistance / 2; // Smaller grid size for more precise neighbor detection
const spatialGrid = new Map();

function init() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
    renderer = new THREE.WebGLRenderer({
        canvas: document.querySelector('#bg-canvas'),
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance'
    });
    
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.sortObjects = false;
    
    camera.position.z = 750;
    
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();
    
    createParticles();
    
    window.addEventListener('resize', throttle(onWindowResize, 100));
    document.addEventListener('mousemove', throttle(onMouseMove, 16));
    window.addEventListener('scroll', throttle(checkVisibility, 100));
    document.addEventListener('mousemove', checkMouseSection);
}

// Reusable objects to avoid garbage collection
const tempVec3 = new THREE.Vector3();
const tempVec3_2 = new THREE.Vector3();

function createParticles() {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particlesCount * 3);
    const velocities = new Float32Array(particlesCount * 3);
    
    for(let i = 0; i < particlesCount * 3; i += 3) {
        positions[i] = (Math.random() - 0.5) * 1000;
        positions[i + 1] = (Math.random() - 0.5) * 1000;
        positions[i + 2] = (Math.random() - 0.5) * 1000;
        
        velocities[i] = (Math.random() - 0.5) * 0.8;
        velocities[i + 1] = (Math.random() - 0.5) * 0.8;
        velocities[i + 2] = (Math.random() - 0.5) * 0.8;
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
    
    const material = new THREE.PointsMaterial({
        size: 3,
        color: 0x00aaff, // Matching neon blue color
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending
    });
    
    particleSystem = new THREE.Points(geometry, material);
    scene.add(particleSystem);
    
    // Create single reusable line material with stable neon blue color
    const lineMaterial = new THREE.LineBasicMaterial({
        color: 0x00aaff, // Same neon blue color
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending
    });
    
    // Preallocate line geometries for reuse
    for (let i = 0; i < maxConnections; i++) {
        const lineGeometry = new THREE.BufferGeometry();
        const positions = new Float32Array(6); // 2 points * 3 coordinates
        lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const line = new THREE.Line(lineGeometry, lineMaterial);
        lines.push(line);
        scene.add(line);
    }
}

// Optimized spatial hashing
function updateSpatialGrid(positions) {
    spatialGrid.clear();
    
    for(let i = 0; i < positions.length; i += 3) {
        const gridX = Math.floor(positions[i] / gridSize);
        const gridY = Math.floor(positions[i + 1] / gridSize);
        const gridZ = Math.floor(positions[i + 2] / gridSize);
        const key = `${gridX},${gridY},${gridZ}`;
        
        if (!spatialGrid.has(key)) {
            spatialGrid.set(key, []);
        }
        spatialGrid.get(key).push(i);
    }
}

function getNeighboringParticles(x, y, z) {
    const gridX = Math.floor(x / gridSize);
    const gridY = Math.floor(y / gridSize);
    const gridZ = Math.floor(z / gridSize);
    const neighbors = new Set(); // Use Set to avoid duplicates
    
    // Check more neighboring cells for better connection distribution
    for(let dx = -2; dx <= 2; dx++) {
        for(let dy = -2; dy <= 2; dy++) {
            for(let dz = -2; dz <= 2; dz++) {
                const key = `${gridX + dx},${gridY + dy},${gridZ + dz}`;
                const particles = spatialGrid.get(key);
                if (particles) {
                    particles.forEach(index => neighbors.add(index));
                }
            }
        }
    }
    
    return Array.from(neighbors);
}

function updateParticles() {
    if (!isHomeVisible) return;
    
    frameCount++;
    const positions = particleSystem.geometry.attributes.position.array;
    const velocities = particleSystem.geometry.attributes.velocity.array;
    
    // Update positions less frequently
    if (frameCount % 2 === 0) {
        for(let i = 0; i < positions.length; i += 3) {
            positions[i] += velocities[i];
            positions[i + 1] += velocities[i + 1];
            positions[i + 2] += velocities[i + 2];
            
            for(let j = 0; j < 3; j++) {
                if(Math.abs(positions[i + j]) > 500) {
                    velocities[i + j] *= -1;
                }
            }
        }
        particleSystem.geometry.attributes.position.needsUpdate = true;
    }
    
    // Update connections every 3rd frame
    if (frameCount % 3 === 0) {
        updateSpatialGrid(positions);
        let connectionCount = 0;
        
        // Hide all lines initially
        for (let i = 0; i < maxConnections; i++) {
            lines[i].visible = false;
        }
        
        // Process particles in chunks for better performance
        const chunkSize = 30;
        for(let chunk = 0; chunk < positions.length && connectionCount < maxConnections; chunk += chunkSize * 3) {
            const endChunk = Math.min(chunk + chunkSize * 3, positions.length);
            
            for(let i = chunk; i < endChunk && connectionCount < maxConnections; i += 3) {
                const neighbors = getNeighboringParticles(positions[i], positions[i + 1], positions[i + 2]);
                let particleConnections = 0;
                
                // Sort neighbors by distance for better connection distribution
                const sortedNeighbors = neighbors
                    .map(neighborIndex => {
                        const dx = positions[neighborIndex] - positions[i];
                        const dy = positions[neighborIndex + 1] - positions[i + 1];
                        const dz = positions[neighborIndex + 2] - positions[i + 2];
                        return {
                            index: neighborIndex,
                            distSquared: dx * dx + dy * dy + dz * dz
                        };
                    })
                    .filter(n => n.distSquared < connectionDistanceSquared && n.index > i)
                    .sort((a, b) => a.distSquared - b.distSquared)
                    .slice(0, 5);
                
                for(const neighbor of sortedNeighbors) {
                    if (connectionCount >= maxConnections) break;
                    if (particleConnections >= 4) break;
                    
                    const neighborIndex = neighbor.index;
                    const linePositions = lines[connectionCount].geometry.attributes.position.array;
                    
                    // Update line positions
                    linePositions[0] = positions[i];
                    linePositions[1] = positions[i + 1];
                    linePositions[2] = positions[i + 2];
                    linePositions[3] = positions[neighborIndex];
                    linePositions[4] = positions[neighborIndex + 1];
                    linePositions[5] = positions[neighborIndex + 2];
                    
                    // Show line with stable appearance
                    lines[connectionCount].visible = true;
                    lines[connectionCount].geometry.attributes.position.needsUpdate = true;
                    
                    connectionCount++;
                    particleConnections++;
                }
            }
        }
    }
}

function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    }
}

function checkMouseSection(event) {
    const homeSection = document.querySelector('#home');
    if (!homeSection) return;
    
    const rect = homeSection.getBoundingClientRect();
    isMouseInHome = (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
    );
}

function checkVisibility() {
    const homeSection = document.querySelector('#home');
    const aboutSection = document.querySelector('#about');
    if (!homeSection || !aboutSection) return;
    
    const homeRect = homeSection.getBoundingClientRect();
    const aboutRect = aboutSection.getBoundingClientRect();
    
    // Check if either home or about sections are visible
    isHomeVisible = (
        (homeRect.top >= 0 && homeRect.bottom <= window.innerHeight) ||
        (aboutRect.top >= 0 && aboutRect.bottom <= window.innerHeight) ||
        (homeRect.top < 0 && homeRect.bottom > 0) ||
        (aboutRect.top < 0 && aboutRect.bottom > 0)
    );
}

function onMouseMove(event) {
    if (!isMouseInHome) {
        mouse.x = 0;
        mouse.y = 0;
        return;
    }
    
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
    // Enhanced 3D movement
    const targetX = mouse.x * 200; // Increased from 50 to 200
    const targetY = mouse.y * 200;
    const targetZ = 750 - Math.abs(mouse.x * mouse.y) * 150; // Dynamic Z movement
    
    camera.position.x += (targetX - camera.position.x) * 0.05;
    camera.position.y += (targetY - camera.position.y) * 0.05;
    camera.position.z += (targetZ - camera.position.z) * 0.02;
    
    camera.lookAt(scene.position);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

let lastFrame = 0;
const frameInterval = 1000 / 60;

function animate(currentTime) {
    requestAnimationFrame(animate);
    
    if (currentTime - lastFrame < frameInterval) return;
    lastFrame = currentTime;
    
    updateParticles();
    renderer.render(scene, camera);
}

// Typewriter animation
const names = ['Vorizon', '8140', 'Mishapolk'];
let currentNameIndex = 0;
let isDeleting = false;
let text = '';
let charIndex = 0;

function typeWriter() {
    const currentName = names[currentNameIndex];
    const shouldDelete = isDeleting;

    if (shouldDelete) {
        // Deleting text
        text = currentName.substring(0, charIndex - 1);
        charIndex--;
    } else {
        // Typing text
        text = currentName.substring(0, charIndex + 1);
        charIndex++;
    }

    document.querySelector('.hero-title span').textContent = text;

    // Typing speed
    let typeSpeed = isDeleting ? 50 : 100;

    // If word is complete
    if (!isDeleting && charIndex === currentName.length) {
        // Make pause at end
        typeSpeed = 2000;
        isDeleting = true;
    } else if (isDeleting && charIndex === 0) {
        isDeleting = false;
        // Move to next word
        currentNameIndex = (currentNameIndex + 1) % names.length;
        // Pause before starting to type
        typeSpeed = 500;
    }

    setTimeout(typeWriter, typeSpeed);
}

document.addEventListener('DOMContentLoaded', () => {
    init();
    animate();
    initializeScrollAnimations();
    // Start typewriter effect
    typeWriter();
});

// Scroll animations
function initializeScrollAnimations() {
    gsap.registerPlugin(ScrollTrigger);
    
    // Animate sections on scroll
    const sections = document.querySelectorAll('section');
    sections.forEach(section => {
        gsap.fromTo(section, 
            {
                opacity: 0,
                y: 50
            },
            {
                opacity: 1,
                y: 0,
                duration: 1,
                scrollTrigger: {
                    trigger: section,
                    start: "top 80%",
                    end: "top 50%",
                    scrub: 1
                }
            }
        );
    });
    
    // Animate skill bars
    const skillBars = document.querySelectorAll('.skill-bar');
    skillBars.forEach(bar => {
        const level = bar.dataset.level + '%';
        bar.style.setProperty('--level', level);
    });

    // Animate stat circles when they come into view
    const statItems = document.querySelectorAll('.stat-item');
    statItems.forEach(item => {
        const circle = item.querySelector('.stat-circle-fill');
        const value = item.dataset.value;
        const circumference = 2 * Math.PI * 45; // r=45 from SVG
        const offset = circumference - (value / 100) * circumference;
        
        gsap.to(circle, {
            strokeDashoffset: offset,
            duration: 1.5,
            ease: "power2.out",
            scrollTrigger: {
                trigger: item,
                start: "top 80%",
                toggleActions: "play none none reverse"
            }
        });
    });

    // Animate tech items when they come into view
    gsap.from('.tech-item', {
        y: 50,
        opacity: 0,
        duration: 0.6,
        stagger: 0.1,
        ease: "power2.out",
        scrollTrigger: {
            trigger: '.tech-grid',
            start: "top 80%",
            toggleActions: "play none none reverse"
        }
    });

    // Animate about text
    gsap.from('.about-text p', {
        x: -50,
        opacity: 0,
        duration: 0.8,
        stagger: 0.2,
        ease: "power2.out",
        scrollTrigger: {
            trigger: '.about-text',
            start: "top 80%",
            toggleActions: "play none none reverse"
        }
    });

    // Animate section title
    gsap.from('.section-title', {
        y: 30,
        opacity: 0,
        duration: 0.8,
        ease: "power2.out",
        scrollTrigger: {
            trigger: '.section-title',
            start: "top 80%",
            toggleActions: "play none none reverse"
        }
    });
}

// Smooth scroll
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const targetId = this.getAttribute('href');
        const targetElement = document.querySelector(targetId);
        
        if (targetElement) {
            // Get the header height for offset
            const headerHeight = document.querySelector('header').offsetHeight;
            
            // Calculate the target position
            let targetPosition;
            if (targetId === '#about') {
                // For about section, ensure exact viewport positioning
                targetPosition = targetElement.offsetTop - headerHeight;
                window.scrollTo({
                    top: targetPosition,
                    behavior: 'smooth'
                });
            } else {
                targetElement.scrollIntoView({
                    behavior: 'smooth'
                });
            }
        }
    });
});

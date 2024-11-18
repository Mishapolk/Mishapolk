const vertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const fragmentShader = `
    uniform float time;
    uniform vec2 resolution;
    varying vec2 vUv;

    void main() {
        vec2 position = vUv * 2.0 - 1.0;
        position.x *= resolution.x / resolution.y;
        
        float color = 0.0;
        
        // Create multiple layers of waves
        for(float i = 0.0; i < 3.0; i++) {
            vec2 p = position;
            p.x += sin(time * 0.5 + i * 1.0) * 0.2;
            p.y += cos(time * 0.5 + i * 1.0) * 0.2;
            
            float d = length(p);
            color += 0.01 / (d * d);
        }
        
        // Add color gradients
        vec3 finalColor = vec3(color * 0.3, color * 0.5, color);
        finalColor *= vec3(0.0, 1.0, 1.0); // Cyan tint
        
        // Add pulse effect
        float pulse = sin(time) * 0.5 + 0.5;
        finalColor *= 1.0 + pulse * 0.2;
        
        gl_FragColor = vec4(finalColor, 1.0);
    }
`;

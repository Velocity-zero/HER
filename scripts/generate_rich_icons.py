import os
import math
from PIL import Image, ImageDraw, ImageFont

def create_clean_vibrant_background(width, height):
    img = Image.new("RGBA", (width, height))
    
    # Smooth diagonal gradient from vibrant red-pink #E61C4C to rich magenta-crimson #AA0F3B
    start_r, start_g, start_b = 0xE6, 0x1C, 0x4C
    end_r, end_g, end_b = 0xAA, 0x0F, 0x3B
    
    for y in range(height):
        for x in range(width):
            t = (x + y) / ((width - 1) + (height - 1))
            r = int(start_r + (end_r - start_r) * t)
            g = int(start_g + (end_g - start_g) * t)
            b = int(start_b + (end_b - start_b) * t)
            img.putpixel((x, y), (r, g, b, 255))
            
    return img

def render_her_text(size=2048, maskable=False):
    bg = create_clean_vibrant_background(size, size)
    
    font_path = "C:/Windows/Fonts/segoeuib.ttf"
    if not os.path.exists(font_path):
        font_path = "C:/Windows/Fonts/arialbd.ttf"
        
    # Font size selection: bold and large
    # Target height is about 42% of canvas size
    font_size = int(size * 0.46 if not maskable else size * 0.38)
    font = ImageFont.truetype(font_path, font_size)
    
    # Measure overall "her" bounding box with native font rendering to get height and baseline info
    dummy_draw = ImageDraw.Draw(bg)
    bbox_all = dummy_draw.textbbox((0, 0), "her", font=font, anchor="lt")
    
    chars = ["h", "e", "r"]
    
    # Calculate tight tracking positioning using font advance lengths
    # We bring letters closer by multiplying advance length by tracking_factor (e.g. 0.88)
    tracking_factor = 0.86
    
    widths = []
    for c in chars:
        w = font.getlength(c)
        widths.append(w)
        
    total_w = sum(widths[i] * tracking_factor for i in range(len(chars) - 1)) + widths[-1]
    
    # Render onto a high-res temporary text layer using anchor="ls" (Left-Baseline alignment)
    # This guarantees 100% perfect vertical baseline alignment for h, e, r!
    text_layer = Image.new("RGBA", (int(total_w + 100), int(font_size * 1.5)), (0, 0, 0, 0))
    t_draw = ImageDraw.Draw(text_layer)
    
    baseline_y = int(font_size * 1.1)
    curr_x = 0
    for i, c in enumerate(chars):
        t_draw.text((curr_x, baseline_y), c, font=font, fill=(255, 255, 255, 255), anchor="ls")
        curr_x += widths[i] * tracking_factor
        
    # Crop to content tight bounding box
    text_bbox = text_layer.getbbox()
    cropped_text = text_layer.crop(text_bbox)
    
    # Target overall text width ratio on the canvas (~78% width for standard, ~66% for maskable)
    target_w_ratio = 0.78 if not maskable else 0.66
    target_w = int(size * target_w_ratio)
    
    scale = target_w / float(cropped_text.width)
    final_w = target_w
    final_h = int(cropped_text.height * scale)
    
    scaled_text = cropped_text.resize((final_w, final_h), Image.Resampling.LANCZOS)
    
    # Center on canvas
    pos_x = int((size - final_w) / 2.0)
    pos_y = int((size - final_h) / 2.0)
    
    bg.paste(scaled_text, (pos_x, pos_y), scaled_text)
    return bg

def main():
    repo_dir = "c:/Users/venee/Downloads/repos/HER"
    icons_dir = os.path.join(repo_dir, "public/icons")
    os.makedirs(icons_dir, exist_ok=True)
    
    print("Generating master perfectly aligned icons...")
    master_standard = render_her_text(size=2048, maskable=False)
    master_maskable = render_her_text(size=2048, maskable=True)
    
    outputs = [
        (master_standard, 512, os.path.join(icons_dir, "icon-512x512.png")),
        (master_maskable, 512, os.path.join(icons_dir, "icon-512x512-maskable.png")),
        (master_standard, 192, os.path.join(icons_dir, "icon-192x192.png")),
        (master_maskable, 192, os.path.join(icons_dir, "icon-192x192-maskable.png")),
        (master_standard, 180, os.path.join(icons_dir, "apple-touch-icon.png")),
        (master_standard, 32,  os.path.join(icons_dir, "favicon-32x32.png")),
        (master_standard, 32,  os.path.join(repo_dir, "public/favicon.ico")),
    ]
    
    for master, target_size, out_path in outputs:
        resized = master.resize((target_size, target_size), Image.Resampling.LANCZOS)
        resized.save(out_path, format="PNG" if not out_path.endswith(".ico") else "ICO")
        print(f"Saved: {out_path} ({target_size}x{target_size})")
        
    app_ico_path = os.path.join(repo_dir, "src/app/favicon.ico")
    ico_img = master_standard.resize((32, 32), Image.Resampling.LANCZOS)
    ico_img.save(app_ico_path, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])
    print(f"Saved multi-res ICO: {app_ico_path}")

if __name__ == "__main__":
    main()
